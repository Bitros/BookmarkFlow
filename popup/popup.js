window.onload = function () {
  document.querySelectorAll("input").forEach(async element => {
    const result = await chrome.storage.local.get([element.id]);
    if(result[element.id]){
      console.debug("get " + element.id + " value " + result[element.id]);
      document.querySelector("#" + element.id).value = result[element.id];
    }
  });
  document.querySelector("#save_gh_profile").disabled = true;
};
const re = /\d/g;
document.querySelector("#save_gh_profile").onclick = function(){
  this.disabled = true;
  const gh_token = document.querySelector("#gh_token").value;
  if (gh_token) {
    chrome.storage.local.set({ "gh_token": gh_token }, () => {
      console.debug("set gh_token : " + gh_token);
      chrome.runtime.sendMessage({ "from": "pop", "gh_token": gh_token }, (response) => {
        console.debug(response);
      });
    });
  } else {
    chrome.storage.local.remove(["gh_token"],() => {
      console.debug("remove gh_token");
      chrome.runtime.sendMessage({ "from": "pop" }, (response) => {
        console.debug(response);
      });
    });
  }
  let interval = document.querySelector("#interval").value;
  if (interval.trim().match(re)) {
    interval = parseInt(interval);
  } else {
    interval = 1;
  }
  chrome.alarms.clearAll();
  chrome.alarms.create({ "periodInMinutes": interval });
  console.debug("set interval : " + interval);
  chrome.storage.local.set({ "interval": interval });
};

document.querySelector("#sync_now").onclick = async function() {
  this.disabled = true;
  const response = await chrome.runtime.sendMessage({ "from": "pop", "sync_now": true });
  console.debug(response);
  this.disabled = false;
};

function enable_btn(){
  document.querySelector("#save_gh_profile").disabled = false;
}
document.querySelector("#gh_token").oninput = enable_btn;
document.querySelector("#interval").oninput = enable_btn;

