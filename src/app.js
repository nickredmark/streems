import React, { useEffect, useState, useRef } from "react";
import { hot } from "react-hot-loader/root";
import { plugins, clone, commit, add, push, pull } from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import { ulid } from "ulid";
import moment from "moment";
import MD from "markdown-it";
import TextareaAutosize from "react-autosize-textarea";
import ReactPlayer from "react-player";
import mila from "markdown-it-link-attributes";

import scrollIntoView from "scroll-into-view-if-needed";
import {
  getTree,
  getStreem,
  filterDescendants,
  findPrev,
  findParent,
  getSearchedNodes,
  findNode,
  WINDOW
} from "./utils";
import { Tweet } from "./components/Tweet";

const md = MD({
  linkify: true
}).use(mila, {
  attrs: {
    target: "_blank"
  }
});

const dir = "/repo";
const file = "streem.mdl";

const App = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const [ctrl, setCtrl] = useState(false);
  const [limit, setLimit] = useState(100);
  const [scrollHeight, setScrollHeight] = useState(0);
  const [nodes, setNodes] = useState();
  const [filteredNodes, setFilteredNodes] = useState();
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [scrolledNode, setScrolledNode] = useState();
  const [filteredNode, setFilteredNode] = useState();
  const startSearch = urlParams.get("search");
  const searchInput = useRef();
  const [search, setSearch] = useState(startSearch);
  const content = useRef();
  const [writing, setWriting] = useState(true);
  const [tree, setTree] = useState();
  const [streem, setStreem] = useState();
  const [nodeTrees, setNodeTrees] = useState();
  const streemRef = useRef();
  const loadMoreRef = useRef();
  const startRepo = urlParams.get("repo");
  const [{ repo, username, token }, setCredentials] = useState({
    repo: startRepo,
    username: localStorage.getItem("username"),
    token: localStorage.getItem("token")
  });
  const repoRef = useRef();
  const usernameRef = useRef();
  const tokenRef = useRef();

  const [status, setStatus] = useState({});

  const [pulled, setPulled] = useState(false);

  const doSearch = search => {
    setNodeTrees(undefined);
    setSearch(search);
  };

  const filterNode = id => {
    setFilteredNode(id);
    selectNode(id);
  };

  const selectNode = (id, scrollIntoView, append) => {
    if (!id) {
      setSelectedNodes([]);
    } else if (append) {
      if (selectedNodes.length) {
        setSelectedNodes(
          filteredNodes
            .slice(
              filteredNodes.findIndex(node => node.id === selectedNodes[0]),
              filteredNodes.findIndex(node => node.id === id) + 1
            )
            .map(node => node.id)
        );
      } else {
        setSelectedNodes([id]);
      }
    } else {
      setSelectedNodes([id]);
    }
    content.current.focus();
    if (scrollIntoView) {
      setScrolledNode({ id });
    }
  };

  const pull = async (repo, username, token) => {
    if (!repo) {
      setNodes([]);
      return;
    }
    let pfs = window.pfs;
    if (!pfs) {
      const fs = new LightningFS(repo, { wipe: true });
      plugins.set("fs", fs);
      window.pfs = fs.promises;
      pfs = window.pfs;
    }
    try {
      await pfs.mkdir(dir);
    } catch (e) {}

    await clone({
      dir,
      corsProxy: "https://git.nmr.io",
      url: `https://github.com/${repo}`, // "https://gist.github.com/73970fa686a71210ee34aa75f41f228a.git",
      ref: "master",
      singleBranch: true,
      depth: 2,
      username,
      token
    });

    let raw;
    try {
      raw = await pfs.readFile(`${dir}/${file}`, "utf8");
    } catch (e) {
      raw = "";
    }
    const parts = raw.split(/\n---\n/).filter(Boolean);
    const streem = [];
    for (const part of parts) {
      const node = {};
      const lines = part.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) {
          node.content = lines
            .slice(i)
            .join("\n")
            .trim();
          break;
        }

        const index = line.indexOf(":");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        node[key] = value;
      }
      streem.push(node);
    }
    setNodes(streem);
    setPulled(true);
  };

  const save = async nodes => {
    try {
      const pfs = window.pfs;
      if (!pfs) {
        return;
      }
      const mdl = nodes
        .map(node => {
          let res = Object.keys(node)
            .filter(key => key !== "content")
            .filter(key => node[key] !== undefined && node[key] !== null)
            .map(
              key =>
                `${key.trim()}: ${
                  typeof node[key] === "string" ? node[key].trim() : node[key]
                }\n`
            )
            .join("");
          if (node.content) {
            res += "\n" + node.content + "\n";
          }
          return res;
        })
        .join("---\n");
      await pfs.writeFile(`${dir}/${file}`, mdl);
      await add({ dir, filepath: file });
      if (!username || !token) {
        setStatus({
          type: "error",
          message: "GitHub credentials needed to save your changes."
        });
        return;
      }
      await commit({
        dir,
        message: "Streem changes",
        author: {
          name: username,
          email: username
        }
      });
      setStatus({ type: "warning", message: "Syncing..." });
      await push({
        dir,
        username,
        token
      });
      setStatus({ type: "success", message: "Synced" });
    } catch (e) {
      console.error(e);
      setStatus({ type: "error", message: "Saving failed." });
    }
  };

  const updateStreem = async update => {
    const newNodes = await new Promise(res =>
      setNodes(nodes => {
        const newNodes = update(nodes);
        res(newNodes);
        return newNodes;
      })
    );
    setStatus({ type: "warning", message: "Not synced" });

    save(newNodes);
  };

  const newNode = async e => {
    try {
      if (e) {
        e.preventDefault();
      }
      if (!content.current.value) {
        return;
      }
      await updateStreem(streem => [
        ...streem,
        {
          id: ulid(),
          created: +new Date(),
          content: content.current.value,
          parent: selectedNodes[selectedNodes.length - 1]
        }
      ]);
      //      streemRef.current.scrollTop = streemRef.current.scrollHeight;
      content.current.value = "";
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  useEffect(() => {
    const onKeyDown = async e => {
      if (e.key === "Tab" && selectedNodes.length) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          await updateStreem(streem => {
            const parent = findParent(selectedNodes[0], streem);
            if (parent) {
              return streem.map(node =>
                selectedNodes.includes(node.id)
                  ? { ...node, parent: parent.parent }
                  : node
              );
            }
            return streem;
          });
        } else {
          await updateStreem(streem => {
            const prev = findPrev(selectedNodes[0], streem);
            if (prev) {
              return streem.map(node =>
                selectedNodes.includes(node.id)
                  ? { ...node, parent: prev.id }
                  : node
              );
            }
            return streem;
          });
        }
      } else if (e.key === "ArrowUp") {
        const next =
          filteredNodes[
            selectedNodes.length
              ? filteredNodes.findIndex(node => node.id === selectedNodes[0]) -
                1
              : filteredNodes.length - 1
          ];
        if (next) {
          selectNode(next.id, true);
        }
      } else if (e.key === "ArrowDown" && selectedNodes.length) {
        const next =
          filteredNodes[
            filteredNodes.findIndex(
              node => node.id === selectedNodes[selectedNodes.length - 1]
            ) + 1
          ];
        if (next) {
          selectNode(next.id, true, e.shiftKey);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        setWriting(true);
        content.current.focus();
      } else if (e.key === "Escape") {
        selectNode();
      } else if (e.key === "Control") {
        setCtrl(true);
      } else if (e.key === "Backspace" && e.ctrlKey && selectedNodes.length) {
        selectNode();
        updateStreem(streem =>
          streem.map(node =>
            selectedNodes.includes(node.id) ? { ...node, deleted: true } : node
          )
        );
      }
    };
    const onKeyUp = e => {
      if (e.key === "Control") {
        setCtrl(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selectedNodes, filteredNodes]);

  useEffect(() => {
    (async () => {
      try {
        if (!pulled) {
          await pull(repo, username, token);
        }
        if (username && token) {
          localStorage.setItem("username", username);
          localStorage.setItem("token", token);
        }
      } catch (e) {
        console.error(e);
        setNodes([]);
        setStatus({
          type: "error",
          message: "Could not pull repo."
        });
        throw e;
      }
      setNodes(nodes => {
        save(nodes);
        return nodes;
      });
    })();
  }, [repo, username, token]);

  useEffect(() => {
    if (nodes) {
      setTree(getTree(nodes));
    }
  }, [nodes]);

  useEffect(() => {
    if (nodes) {
      setFilteredNodes(filterDescendants(nodes, filteredNode));
    }
  }, [nodes, filteredNode]);

  useEffect(() => {
    if (nodes && filteredNodes) {
      setStreem(getStreem(nodes, filteredNodes, limit));
    }
  }, [limit, nodes, filteredNodes]);

  /*
  useEffect(() => {
    if (streemRef.current) {
      const diff = streemRef.current.scrollHeight - scrollHeight;
      if (diff > 0) {
        streemRef.current.scrollTop = diff;
        setScrollHeight(streemRef.current.scrollHeight);
      }
    }
  }, [streemRef.current, streem]);
  */

  useEffect(() => {
    if (nodes && search) {
      const searchedNodes = getSearchedNodes(nodes, search);
      const trees = {};
      for (const word of Object.keys(searchedNodes).sort(
        (a, b) =>
          searchedNodes[a].matches - searchedNodes[b].matches ||
          searchedNodes[b].words - searchedNodes[a].words
      )) {
        trees[word] = {
          matches: searchedNodes[word].matches,
          tree: getTree(searchedNodes[word].nodes)
        };
      }
      setNodeTrees(trees);
    } else {
      setNodeTrees();
    }
  }, [nodes && search]);

  if (!streem) {
    return <div>Loading...</div>;
  }

  return (
    <main className={ctrl ? "ctrl" : ""}>
      <div
        className="sidebar"
        onKeyDown={e => {
          if (e.key === "Tab" || e.key === "Enter") {
            e.stopPropagation();
          }
        }}
      >
        <div className="toc">
          <Tree tree={tree} height={0} filterNode={filterNode} />
        </div>
        {
          <div className="storage">
            <h4>Storage</h4>
            <form
              onSubmit={async e => {
                e.preventDefault();
                setCredentials({
                  repo: repoRef.current.value,
                  username: usernameRef.current.value,
                  token: tokenRef.current.value
                });
              }}
            >
              <input
                placeholder="GitHub repo, e.g. nmaro/notes"
                ref={repoRef}
                defaultValue={repo}
              />
              <input
                placeholder="GitHub email"
                ref={usernameRef}
                defaultValue={username}
              />
              <input
                type="password"
                placeholder="GitHub access token"
                ref={tokenRef}
                defaultValue={token}
              />
              <button type="submit">Sync</button>
            </form>
            <span className={status.type}>{status.message}</span>
          </div>
        }
      </div>
      <div className="mainbar" onClick={() => selectNode()}>
        {!repo ||
          (pulled && (
            <>
              <div className="content" ref={streemRef}>
                <div className="streem">
                  {limit < filteredNodes.length && (
                    <div
                      className="load-more"
                      onClick={() => setLimit(limit + 100)}
                      ref={loadMoreRef}
                    >
                      <button>Load more</button>
                    </div>
                  )}
                  <Streem
                    depth={0}
                    tree={streem}
                    selectedNodes={selectedNodes}
                    scrolledNode={scrolledNode}
                    selectNode={selectNode}
                    filteredNode={filteredNode}
                    filterNode={filterNode}
                    setSearch={search => {
                      doSearch(search);
                      searchInput.current.value = search;
                    }}
                  />
                  {limit > WINDOW && (
                    <div
                      className="load-more"
                      onClick={() => setLimit(limit - 100)}
                      ref={loadMoreRef}
                    >
                      <button>Load more</button>
                    </div>
                  )}
                </div>
              </div>
              <div
                className={`input ${writing ? "writing" : ""}`}
                onClick={e => e.stopPropagation()}
              >
                {selectedNodes.length > 0 && (
                  <div className="path">
                    {
                      findNode(selectedNodes[selectedNodes.length - 1], nodes)
                        .content
                    }
                  </div>
                )}
                <form onSubmit={newNode}>
                  <TextareaAutosize
                    placeholder="type a thought"
                    autoFocus
                    onKeyDown={e => {
                      if (!e.shiftKey && e.key === "Enter") {
                        e.preventDefault();
                        newNode();
                      }
                    }}
                    ref={content}
                  />
                </form>
              </div>
            </>
          ))}
      </div>
      <div
        className="searchbar"
        onKeyDown={e => {
          e.stopPropagation();
        }}
      >
        <div className="search">
          <form
            onSubmit={e => {
              e.preventDefault();
              e.stopPropagation();
              doSearch(searchInput.current.value);
            }}
          >
            <input
              ref={searchInput}
              defaultValue={startSearch}
              placeholder="search"
            />
            <input
              type="submit"
              style={{
                position: "absolute",
                left: "-9999px",
                visibility: "collapse"
              }}
              tabIndex="-1"
            />
          </form>
        </div>
        <div className="search-results">
          {search &&
            (nodeTrees ? (
              Object.keys(nodeTrees).map(word => (
                <div key={word}>
                  <b>
                    {word} ({nodeTrees[word].matches} matches)
                  </b>
                  <Tree
                    height={10}
                    tree={nodeTrees[word].tree}
                    filteredNode={filteredNode}
                    filterNode={filterNode}
                  />
                </div>
              ))
            ) : (
              <span>Loading results...</span>
            ))}
        </div>
      </div>
    </main>
  );
};

const Streem = props => {
  const { tree } = props;
  return (
    <div className="nodes">
      {tree.children.map(node => (
        <Node key={`${node.id}-${node.iteration}`} {...props} node={node} />
      ))}
    </div>
  );
};

const Node = ({
  depth,
  node,
  selectedNodes,
  scrolledNode,
  selectNode,
  filteredNode,
  filterNode,
  setSearch
}) => {
  const ref = useRef();
  useEffect(() => {
    if (
      scrolledNode &&
      scrolledNode.id === node.id &&
      ref.current &&
      !node.iteration
    ) {
      scrollIntoView(ref.current, {
        behavior: "smooth",
        scrollMode: "if-needed"
      });
    }
  }, [scrolledNode]);
  return (
    <div
      className={`node ${selectedNodes.includes(node.id) ? "selected" : ""} ${
        filteredNode === node.id ? "filtered" : ""
      } ${node.iteration > 0 ? "continued" : ""}`}
    >
      <div
        className="node-content"
        ref={ref}
        onClick={e => {
          // e.preventDefault();
          e.stopPropagation();
          selectNode(node.id, false, e.shiftKey);
          if (e.ctrlKey) {
            if (filteredNode === node.id) {
              filterNode();
            } else {
              filterNode(node.id);
            }
          }
        }}
        onDoubleClick={e => {
          // e.preventDefault();
          e.stopPropagation();
          setSearch(node.content);
        }}
      >
        <li>
          <NodeContent node={node} />
        </li>
      </div>
      <div className="node-date">
        {moment(+node.created).format("MMM DD, YYYY")}
      </div>
      <Streem
        depth={depth + 1}
        tree={node}
        selectedNodes={selectedNodes}
        selectNode={selectNode}
        scrolledNode={scrolledNode}
        filteredNode={filteredNode}
        filterNode={filterNode}
        setSearch={setSearch}
      />
    </div>
  );
};

const NodeContent = ({ node }) => (
  <div>
    <span
      dangerouslySetInnerHTML={{
        __html: md.renderInline(node.content || "")
      }}
    />
    <SpecialContent node={node} />
  </div>
);

const SpecialContent = ({ node }) => {
  if (
    /^(https?:\/\/(www\.)?)?youtube\.com\/watch/.exec(node.content) ||
    /^(https?:\/\/(www\.)?)?youtu\.be\//.exec(node.content)
  ) {
    return (
      <div className="player-wrapper">
        <ReactPlayer
          className="react-player"
          url={node.content}
          width="100%"
          height="100%"
        />
      </div>
    );
  }

  if (/twitter.com\/\w+\/status\/\d+/.exec(node.content)) {
    return <Tweet url={node.content.split("/").pop()} />;
  }

  return null;
};

const LIMIT = 10;

const Tree = ({ tree, filterNode, height }) => (
  <div className="nodes">
    {tree.children.slice(0, LIMIT).map(node => (
      <div key={node.id} className="node">
        <div
          className="node-content"
          onClick={e => {
            e.stopPropagation();
            filterNode(node.id);
          }}
        >
          <li>
            <NodeContent node={node} />
          </li>
          {height > 0 && node.children && (
            <Tree height={height - 1} tree={node} filterNode={filterNode} />
          )}
        </div>
      </div>
    ))}
    {tree.children.length > LIMIT && <div>...</div>}
  </div>
);

export default hot(App);
