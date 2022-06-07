import { Octokit } from "https://cdn.skypack.dev/@octokit/core";


function send_prompt(prompt) {
    chrome.notifications.create(
        { "message": prompt, "type": "basic", "title": "Bookmark Flow Prompt", "iconUrl": "/icons/bf128x128.png" },
    );
}

function r_search_from_top(source_bookmark_root, target_bookmark_root, need_id) {
    if (need_id) {
        target_bookmark_root[source_bookmark_root.title] = { "bf_internal_url": source_bookmark_root.url, "bf_internal_index": source_bookmark_root.index, "bf_internal_id": source_bookmark_root.id };
    } else {
        target_bookmark_root[source_bookmark_root.title] = { "bf_internal_url": source_bookmark_root.url, "bf_internal_index": source_bookmark_root.index };
    }
    if (source_bookmark_root.children) {
        for (let index = 0; index < source_bookmark_root.children.length; index++) {
            const source_child = source_bookmark_root.children[index];
            target_bookmark_root[source_bookmark_root.title][source_child.title] = { "url": source_child.url, "index": source_child.index }
            const target_child = target_bookmark_root[source_bookmark_root.title];
            r_search_from_top(source_child, target_child, need_id);
        }
    }
}

function reconstruct_bookmark_tree_node(bookmarkTreeNode, need_id) {
    const source_bookmark_root = bookmarkTreeNode[0];
    source_bookmark_root.title = "root";
    for (let index = 0; index < source_bookmark_root.children.length; index++) {
        const child = source_bookmark_root.children[index];
        if (child.title == "Bookmarks bar" || child.title == "Favorites bar") {
            child.title = "Bar";
        } else if (child.title == "Other bookmarks" || child.title == "Other favorites") {
            child.title = "Other";
        }
    }
    const target_bookmark_root = {};
    r_search_from_top(source_bookmark_root, target_bookmark_root, need_id);
    return target_bookmark_root;
}
function r_sync(base_bookmarks, target_bookmarks, func, update) {
    for (let key in base_bookmarks) {
        if (key.indexOf("bf_internal_") != -1) {
            continue;
        }
        if (!target_bookmarks[key]) {
            func(key, base_bookmarks[key], target_bookmarks["bf_internal_id"]);
        } else {
            if ("object" === typeof base_bookmarks[key]) {
                const next_base_bookmarks = base_bookmarks[key];
                const next_target_bookmarks = target_bookmarks[key];
                if (update && next_base_bookmarks["bf_internal_url"] && next_target_bookmarks["bf_internal_url"]
                    && next_base_bookmarks["bf_internal_url"] !== next_target_bookmarks["bf_internal_url"]) {
                    //update url
                    console.debug(`update bookmark ${key}`);
                    chrome.bookmarks.update(next_target_bookmarks["bf_internal_id"], { "url": next_base_bookmarks["bf_internal_url"] });
                }
                if (update && next_base_bookmarks["bf_internal_index"] && next_target_bookmarks["bf_internal_index"]
                    && next_base_bookmarks["bf_internal_index"] !== next_target_bookmarks["bf_internal_index"]) {
                    //re-order
                    console.debug(`move bookmark ${key}`);
                    chrome.bookmarks.move(next_target_bookmarks["bf_internal_id"], { "index": next_base_bookmarks["bf_internal_index"] });
                }
                r_sync(next_base_bookmarks, next_target_bookmarks, func, update);
            }
        }
    }
}
function del(title, bookmark, _) {
    console.debug(`delete local bookmarks title:${title}, bookmark:${JSON.stringify(bookmark)}`);
    if (bookmark["bf_internal_url"]) {
        chrome.bookmarks.remove(bookmark["bf_internal_id"], () => { console.debug(`remove bookmark ${title}`); });
    } else {
        // delete folder and corresponding bookmarks
        chrome.bookmarks.removeTree(bookmark["bf_internal_id"], () => { console.debug(`remove bookmark folder ${title}`); });
    }
}
function add(title, bookmark, parent_id) {
    if (bookmark["bf_internal_url"]) {
        console.debug(`add local bookmarks title:${title}, bookmark:${JSON.stringify(bookmark)}`);
        chrome.bookmarks.create({ "title": title, "url": bookmark["bf_internal_url"], "index": bookmark["bf_internal_index"], "parentId": parent_id });
    } else {
        // recursively add folder and corresponding bookmarks
        r_add(title, bookmark, parent_id);
    }
}
async function r_add(title, bookmark, parent_id) {
    const created = await chrome.bookmarks.create(
        { "title": title, "url": bookmark["bf_internal_url"], "index": bookmark["bf_internal_index"], "parentId": parent_id }
    );
    console.debug(`add local bookmarks title:${title}, bookmark:${JSON.stringify(bookmark)}`);
    const next_parent_id = created.id;
    for (let key in bookmark) {
        if (key.indexOf("bf_internal_") != -1) {
            continue;
        }
        r_add(key, bookmark[key], next_parent_id);
    }
}
function sync(local_bookmarks, remote_bookmarks) {
    clear_bookmark_listener();
    r_sync(local_bookmarks, remote_bookmarks, del);
    r_sync(remote_bookmarks, local_bookmarks, add, true);
    setTimeout(add_bookmark_listener, 1000);
}

async function create_gist() {
    const octokit = await get_octokit();
    if (octokit) {
        const bookmarks = await chrome.bookmarks.getTree();
        const last_update_time = Date.now().toString();
        octokit.request("POST /gists", {
            public: false,
            files: {
                "bookmark_flow_gist.bf": { "content": JSON.stringify(reconstruct_bookmark_tree_node(bookmarks, false)) },
                "bookmark_flow_gist.bft": { "content": last_update_time }
            }
        }).then(response => {
            chrome.storage.local.set({ "gh_gist_id": response.data.id }, () => {
                console.debug("set gh_gist_id : " + response.data.id);
            });
            chrome.storage.local.set({ "last_update_time": last_update_time }, () => {
                console.debug("set last_update_time : " + last_update_time);
            });
            send_prompt("Configured and started");
        }).catch(response => {
            console.debug(JSON.stringify(response));
            let msg = "";
            if(response.response && response.response.data){
                msg = response.response.data.message;
            }
            send_prompt(response.status + " " + msg);
        });
    }
}


async function check_gist() {
    const octokit = await get_octokit();
    if (octokit) {
        octokit.request("GET /gists").then(response => {
            let gist_flag = false;
            const gists = response.data;
            for (let index = 0; index < gists.length; index++) {
                const gist = gists[index];
                const files = gist.files;
                if (files["bookmark_flow_gist.bf"]) {

                    console.debug("gist exits");
                    chrome.storage.local.set({ "gh_gist_id": gist.id }, () => {
                        console.debug("set gh_gist_id : " + gist.id);
                    });

                    // compare and sync
                    fetch(files["bookmark_flow_gist.bf"].raw_url).then(async (response) => {
                        const remote_bookmarks_str = await response.text();
                        const bookmarks = await chrome.bookmarks.getTree();
                        let local_bookmarks = reconstruct_bookmark_tree_node(bookmarks, false);
                        const local_bookmarks_str = JSON.stringify(local_bookmarks);
                        if (local_bookmarks_str !== remote_bookmarks_str) {
                            local_bookmarks = reconstruct_bookmark_tree_node(bookmarks, true);
                            sync(local_bookmarks, JSON.parse(remote_bookmarks_str));
                        }
                    }).catch(response => {
                        console.debug(JSON.stringify(response));
                    });

                    fetch(files["bookmark_flow_gist.bft"].raw_url).then(async (response) => {
                        const last_update_time = await response.text();
                        chrome.storage.local.set({ "last_update_time": last_update_time }, () => {
                            console.debug("set last_update_time : " + last_update_time);
                        });
                    }).catch(response => {
                        console.debug(JSON.stringify(response));
                    });

                    gist_flag = true;
                    send_prompt("Configured and started");
                    break;
                }
            }
            if (!gist_flag) {
                console.debug("no gist found and create new");
                create_gist();
            }
        }).catch(response => {
            console.debug(JSON.stringify(response));
            let msg = "";
            if(response.response && response.response.data){
                msg = response.response.data.message;
            }
            send_prompt(response.status + " " + msg);
        });
    }
}

async function get_octokit() {
    if (!global_octokit) {
        await recreate_octokit();
    }
    return global_octokit;
}

let global_octokit;
async function recreate_octokit() {
    const gh_token_obj = await chrome.storage.local.get(["gh_token"]);
    const gh_token = gh_token_obj.gh_token;
    if (gh_token) {
        console.debug("get a token and init octokit now.", gh_token);
        global_octokit = new Octokit({ auth: gh_token });
    } else {
        console.debug("no token and send notification");
        send_prompt("Please enter Github token");
    }
}

chrome.runtime.onMessage.addListener(
    (msg, _, sendResponse) => {
        if (msg.from === "pop") {
            if(msg.sync_now){
                pull();
            }else{
                console.debug("token added & changed and start to check Gist. ", msg);
                recreate_octokit();
                check_gist()
            }
            sendResponse("OK");
        }
    }
);


function openPopup() {
    chrome.tabs.create({ "active": true, "url": "popup/popup.html" });
}
chrome.runtime.onInstalled.addListener(openPopup);
chrome.notifications.onClicked.addListener(openPopup);



async function direct_push() {
    const octokit = await get_octokit();
    if (octokit) {
        const gist_id_obj = await chrome.storage.local.get(["gh_gist_id"]);
        if (gist_id_obj.gh_gist_id) {
            const bookmarks = await chrome.bookmarks.getTree();
            const last_update_time = Date.now().toString();
            octokit.request('PATCH /gists/{gist_id}', {
                gist_id: gist_id_obj.gh_gist_id,
                files: {
                    "bookmark_flow_gist.bf": { "content": JSON.stringify(reconstruct_bookmark_tree_node(bookmarks, false)) },
                    "bookmark_flow_gist.bft": { "content": last_update_time }
                }
            }).then(response => {
                chrome.storage.local.set({ "last_update_time": last_update_time }, () => {
                    console.debug("set last_update_time : " + last_update_time);
                });
                console.debug(response.status);
            }).catch(response => {
                console.debug(JSON.stringify(response));
                let msg = "";
                if(response.response && response.response.data){
                    msg = response.response.data.message;
                }
                send_prompt(response.status + " " + msg);
            });
        } else {
            send_prompt("No gist id found. Maybe you clear the local storage cache");
        }
    }
}
let task_id;
async function push(id, bookmark) {
    console.debug(`Detect bookmark changing event ${id}, ${JSON.stringify(bookmark)}`);
    const gh_gist_id_obj = await chrome.storage.local.get(["gh_gist_id"]);
    if (!gh_gist_id_obj.gh_gist_id) {
        console.debug("No gist id found. Checking...");
        check_gist();
    }
    if(task_id){
        clearTimeout(task_id);
    }
    task_id = setTimeout(direct_push, 1500);
}

async function pull() {
    const octokit = await get_octokit();
    if (octokit) {
        // compare bookmark_flow_gist.bft
        const gh_gist_id_obj = await chrome.storage.local.get(["gh_gist_id"]);
        if (gh_gist_id_obj.gh_gist_id) {
            const gist_files = await octokit.request('GET /gists/{gist_id}', {
                gist_id: gh_gist_id_obj.gh_gist_id
            }).then(response => {
                return response.data.files;
            }).catch(response => {
                console.debug(JSON.stringify(response));
            });
            const remote_last_update_time = gist_files["bookmark_flow_gist.bft"].content;
            const last_update_time_obj = await chrome.storage.local.get(["last_update_time"]);
            if (last_update_time_obj.last_update_time && remote_last_update_time === last_update_time_obj.last_update_time) {
                console.debug(remote_last_update_time);
                console.debug("No updates detected with last_update_time");
            } else {
                // compare bookmark object
                const bookmarks = await chrome.bookmarks.getTree();
                let local_bookmarks = reconstruct_bookmark_tree_node(bookmarks, false);
                const local_bookmarks_str = JSON.stringify(local_bookmarks);
                const remote_bookmarks_str = gist_files["bookmark_flow_gist.bf"].content;
                if (local_bookmarks_str === remote_bookmarks_str) {
                    console.debug("No updates detected with bookmarks");
                } else {
                    local_bookmarks = reconstruct_bookmark_tree_node(bookmarks, true);
                    sync(local_bookmarks, JSON.parse(remote_bookmarks_str));
                }
                chrome.storage.local.set({ "last_update_time": remote_last_update_time }, () => {
                    console.debug("set last_update_time : " + remote_last_update_time);
                });
            }
        } else {
            console.debug("No gist id found.");
        }
    }
}

function add_bookmark_listener() {
    chrome.bookmarks.onChanged.addListener(push);
    chrome.bookmarks.onChildrenReordered.addListener(push);
    chrome.bookmarks.onCreated.addListener(push);
    chrome.bookmarks.onImportEnded.addListener(push);
    chrome.bookmarks.onMoved.addListener(push);
    chrome.bookmarks.onRemoved.addListener(push);
}

async function clear_bookmark_listener() {
    await chrome.bookmarks.onChanged.removeListener(push);
    await chrome.bookmarks.onChildrenReordered.removeListener(push);
    await chrome.bookmarks.onCreated.removeListener(push);
    await chrome.bookmarks.onImportEnded.removeListener(push);
    await chrome.bookmarks.onMoved.removeListener(push);
    await chrome.bookmarks.onRemoved.removeListener(push);
}

chrome.alarms.onAlarm.addListener(pull);
add_bookmark_listener();

