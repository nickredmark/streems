import React, { useEffect, useState, useRef } from "react";
import { hot } from "react-hot-loader/root";
import { plugins, clone, commit, add, push } from "isomorphic-git";
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
const fs = new LightningFS("fs", { wipe: true });
plugins.set("fs", fs);
window.pfs = fs.promises;

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
  const [repo, setRepo] = useState(startRepo);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({});

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

  const save = async () => {
    try {
      await commit({
        dir,
        message: "Streem changes",
        author: {
          name: username,
          email: username
        }
      });
      setStatus({ type: "warning", message: "Saving..." });
      await push({
        dir,
        username,
        password
      });
      setStatus({ type: "success", message: "Saved" });
    } catch (e) {
      console.error(e);
      setStatus({ type: "error", message: "Saving failed." });
    }
  };

  const updateStreem = async (message, update) => {
    const newStreem = await new Promise(res =>
      setNodes(streem => {
        const newStreem = update(streem);
        res(newStreem);
        return newStreem;
      })
    );
    setStatus({ type: "warning", message: "Unsaved" });

    (async () => {
      try {
        const mdl = newStreem
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
        if (!username || !password) {
          setStatus({
            type: "error",
            message: "GitHub credentials needed to save your changes."
          });
          return;
        }
        await save();
      } catch (e) {
        console.error(e);
        throw e;
      }
    })();
  };

  const newNode = async e => {
    try {
      if (e) {
        e.preventDefault();
      }
      if (!content.current.value) {
        return;
      }
      await updateStreem(content.current.value, streem => [
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
          await updateStreem(`outdent ${selectedNodes.join(",")}`, streem => {
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
          await updateStreem(`indent ${selectedNodes.join(",")}`, streem => {
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
        updateStreem(`delete ${selectedNodes.join(",")}`, streem =>
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
        if (!repo) {
          setNodes([]);
          return;
        }
        await pfs.mkdir(dir);
        await clone({
          dir,
          corsProxy: "https://git.nmr.io",
          url: `https://github.com/${repo}`, // "https://gist.github.com/73970fa686a71210ee34aa75f41f228a.git",
          ref: "master",
          singleBranch: true,
          depth: 2
        });
        if (!pfs.exi) await pfs.stat(`${dir}/${file}`);

        const raw = await pfs.readFile(`${dir}/${file}`, "utf8");
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
      } catch (e) {
        console.error(e);
        throw e;
      }
    })();
  }, [repo]);

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
          if (e.key === "Tab") {
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
              onSubmit={e => {
                e.preventDefault();
                save();
              }}
            >
              <input
                placeholder="GitHub repo, e.g. nmaro/notes"
                value={repo}
                onChange={e => setRepo(e.target.value)}
              />
              <input
                placeholder="GitHub email"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
              <input
                type="password"
                placeholder="GitHub password or token"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button type="submit" style={{ visibility: "collapse" }} />
            </form>
            <span className={status.type}>{status.message}</span>
          </div>
        }
      </div>
      <div className="mainbar" onClick={() => selectNode()}>
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
              {findNode(selectedNodes[selectedNodes.length - 1], nodes).content}
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
