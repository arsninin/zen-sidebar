const $ = s => document.querySelector(s);
const defaults = { showTools: true, showUrl: true };
async function load() {
  const { prefs = {} } = await chrome.storage.local.get('prefs');
  $('#showtools').checked = prefs.showTools !== false;
  $('#showurl').checked = prefs.showUrl !== false;
}
async function save() {
  const { prefs = {} } = await chrome.storage.local.get('prefs');
  const next = {
    ...defaults,
    ...prefs,
    showTools: $('#showtools').checked,
    showUrl: $('#showurl').checked
  };
  await chrome.storage.local.set({ prefs: next });
  $('#status').textContent = 'Настройки сохранены';
  $('#status').classList.add('saved');
}
$('#showtools').addEventListener('change', save);
$('#showurl').addEventListener('change', save);
load().catch(error => {
  $('#status').textContent = 'Не удалось загрузить настройки: ' + error.message;
});
