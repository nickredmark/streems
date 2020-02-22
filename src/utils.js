import { WordTokenizer, PorterStemmer } from "natural";

const tokenizer = new WordTokenizer();

export const WINDOW = 200;

export const getTree = (nodes, parentId) => {
  const children = [];
  let height = 0;
  for (const node of nodes.filter(node => node.parent === parentId)) {
    const subTree = getTree(nodes, node.id);
    height = Math.max(height, subTree.height + 1);
    children.push({
      ...node,
      ...subTree
    });
  }
  return {
    height,
    children
  };
};

export const getStreem = (nodes, filteredStreem, limit) => {
  const children = [];
  const used = {};
  const start = Math.max(0, filteredStreem.length - limit);
  for (const node of filteredStreem.slice(start, start + WINDOW + 1)) {
    const path = findPath(node.id, nodes);
    let currentTree = children;
    for (const part of path) {
      if (
        !currentTree.length ||
        part.id !== currentTree[currentTree.length - 1].id
      ) {
        used[part.id] = used[part.id] === undefined ? 0 : used[part.id] + 1;
        currentTree.push({
          ...part,
          iteration: used[part.id],
          children: []
        });
      }
      currentTree = currentTree[currentTree.length - 1].children;
    }
  }
  const height = setHeight(children);
  return { height, children };
};

export const filterDescendants = (streem, id) =>
  id
    ? streem.filter(node =>
        findPath(node.id, streem).some(node => node.id === id)
      )
    : [...streem];

const filterTree = (node, limit, count = 0) => {
  count++;
  if (!node.children || count >= limit) {
    return { node: node, count };
  }
  const children = [];
  for (let i = node.children.length - 1; i >= 0; i--) {
    const res = filterTree(node.children[i], limit, count);
    count = res.count;
    children.push(res.node);
    if (count >= limit) {
      break;
    }
  }
  return { node: { ...node, children: children.reverse() }, count };
};

const setHeight = tree => {
  let height = 0;
  for (const node of tree) {
    node.height = setHeight(node.children);
    height = Math.max(height, node.height + 1);
  }
  return height;
};

export const findPrev = (id, nodes) => {
  const index = nodes.findIndex(node => node.id === id);
  const node = nodes[index];
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].parent === node.parent) {
      return nodes[i];
    }
  }
};

export const getChildren = (nodes, id) =>
  nodes.filter(node => node.parent === id);

export const findNode = (id, nodes) => nodes.find(node => node.id === id);

export const findParent = (id, streem) => {
  const node = findNode(id, streem);
  return node.parent && findNode(node.parent, streem);
};

const findPath = (id, streem) => {
  const path = [];
  while (id) {
    const node = findNode(id, streem);
    path.push(node);
    id = node.parent;
  }
  return path.reverse();
};

export const findAncestors = (id, streem) => findPath(id, streem).slice(0, -1);

const getStems = text => {
  const tokens = tokenizer.tokenize(typeof text === "string" ? text : "");
  const stems = {};
  for (const token of tokens) {
    const stem = PorterStemmer.stem(token);
    if (stem.length > 3) {
      stems[token] = stem;
    }
  }
  return stems;
};

export const getSearchedNodes = (nodes, search) => {
  const nodeStems = getStems(search);
  const searchedNodes = {};
  for (const node of nodes) {
    const matchingWordsByWord = {};
    for (const word of Object.keys(nodeStems)) {
      const stem = nodeStems[word];
      const stems = getStems(node.content);
      const matchingWords = Object.keys(stems).filter(w => stems[w] === stem);
      if (matchingWords.length) {
        matchingWordsByWord[word] = matchingWords;
      }
    }
    for (const wordSubset of getAllWordSubsets(
      Object.keys(matchingWordsByWord)
    )) {
      const wordSubsetString = wordSubset.join(" ");
      if (!searchedNodes[wordSubsetString]) {
        searchedNodes[wordSubsetString] = {
          words: wordSubset.length,
          nodes: []
        };
      }
      searchedNodes[wordSubsetString].nodes.push({
        ...node,
        content: wordSubset.reduce(
          (content, word) =>
            matchingWordsByWord[word].reduce(
              (content, word) =>
                content.replace(
                  new RegExp(`\\b${escapeRegExp(word)}\\b`, "g"),
                  "**$&**"
                ),
              content
            ),
          node.content
        )
      });
    }
  }
  const res = {};
  for (const word of Object.keys(searchedNodes)) {
    const sn = searchedNodes[word];
    if (sn.nodes.length === 1) {
      continue;
    }
    res[word] = {
      words: sn.words,
      matches: sn.nodes.length,
      nodes: completeNodes(sn.nodes, nodes)
    };
  }
  return res;
};

const getAllWordSubsets = theArray =>
  theArray
    .reduce(
      (subsets, value) => subsets.concat(subsets.map(set => [...set, value])),
      [[]]
    )
    .filter(arr => arr.length);

const completeNodes = (nodesSubset, nodes) => {
  const res = [...nodesSubset];
  for (const node of nodesSubset) {
    let parentId = node.parent;
    while (parentId) {
      if (res.some(node => node.id === parentId)) {
        break;
      }
      const parent = findNode(parentId, nodes);
      res.push(parent);
      parentId = parent.parent;
    }
  }
  return res;
};

const escapeRegExp = string => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
