(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let selectedId = null;
  let nextCursor;
  let cursor;
  let timer;
  let controller;
  let generation = 0;
  let previousDetail = '';
  let enabled = false;

  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  function date(value) { return new Date(value).toLocaleString(); }
  function status(value) { return node('span', value.replaceAll('_', ' '), `status ${value}`); }
  async function request(path, signal) {
    const response = await fetch(`/api/monitoring${path}`, { credentials: 'same-origin', cache: 'no-store', signal });
    if (response.status === 401) {
      location.assign('/auth/login?next=%2Fmonitor%2F');
      throw new Error('Session expired. Sign in again.');
    }
    if (!response.ok) throw new Error('Monitoring source unavailable. Data below may be out of date.');
    return response.json();
  }
  function renderRuns(items) {
    const list = byId('runs');
    list.replaceChildren();
    byId('run-count').textContent = String(items.length);
    if (!items.length) list.append(node('p', 'No runs on this page.', 'empty'));
    items.forEach(run => {
      const button = node('button', undefined, 'run');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(run.id === selectedId));
      button.append(status(run.status), node('span', run.id, 'id'), node('time', date(run.createdAt)));
      button.addEventListener('click', () => {
        if (selectedId === run.id) return;
        selectedId = run.id;
        previousDetail = '';
        byId('detail').replaceChildren(node('p', 'Loading transcript…', 'empty'));
        void refresh();
      });
      list.append(button);
    });
  }
  function renderDetail(transcript) {
    const signature = JSON.stringify(transcript);
    if (signature === previousDetail) return;
    previousDetail = signature;
    const { run, messages, events } = transcript;
    const detail = byId('detail');
    detail.replaceChildren();
    const head = node('div', undefined, 'detail-head');
    head.append(status(run.status), node('h2', run.id));
    head.append(node('div', `Conversation: ${run.conversationId}\nCreated: ${date(run.createdAt)}${run.startedAt ? `\nStarted: ${date(run.startedAt)}` : ''}${run.finishedAt ? `\nFinished: ${date(run.finishedAt)}` : ''}`, 'metadata'));
    if (run.error) head.append(node('p', run.error, 'error'));
    if (run.usage) head.append(node('pre', JSON.stringify(run.usage, null, 2)));
    detail.append(head, node('h2', 'Transcript'));
    if (!messages.length) detail.append(node('p', 'No messages yet.'));
    messages.forEach(message => {
      const card = node('article', undefined, `message ${message.role}`);
      card.append(node('h3', `${message.role === 'user' ? 'User' : 'Assistant'} · ${date(message.createdAt)}`), node('div', message.content, 'content'));
      detail.append(card);
    });
    const activity = node('details');
    activity.append(node('summary', `Execution events (${events.length})`));
    activity.append(node('pre', events.map(event => `${event.seq} · ${date(event.createdAt)} · ${event.type}\n${JSON.stringify(event.data, null, 2)}`).join('\n\n') || 'No events yet.'));
    detail.append(activity);
  }
  async function refresh() {
    clearTimeout(timer);
    controller?.abort();
    if (!enabled || document.hidden) return;
    const ownGeneration = ++generation;
    const ownController = new AbortController();
    controller = ownController;
    const timeout = setTimeout(() => ownController.abort(), 8000);
    byId('refresh').disabled = true;
    try {
      const list = await request(`/runs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, ownController.signal);
      if (ownGeneration !== generation) return;
      nextCursor = list.nextCursor;
      renderRuns(list.items);
      byId('older').hidden = !nextCursor;
      if (selectedId) {
        const transcript = await request(`/runs/${encodeURIComponent(selectedId)}/transcript`, ownController.signal);
        if (ownGeneration !== generation) return;
        renderDetail(transcript);
      }
      byId('connection').className = '';
      byId('connection').textContent = `Connected · Updated ${new Date().toLocaleTimeString()} · Refreshes every 4 seconds`;
    } catch (error) {
      if (ownGeneration === generation) {
        byId('connection').className = 'error';
        byId('connection').textContent = error.name === 'AbortError' ? 'Refresh timed out. Retrying shortly.' : error.message;
      }
    } finally {
      clearTimeout(timeout);
      if (ownGeneration === generation) {
        byId('refresh').disabled = false;
        timer = setTimeout(() => { void refresh(); }, 4000);
      }
    }
  }
  byId('refresh').addEventListener('click', () => { cursor = undefined; void refresh(); });
  byId('older').addEventListener('click', () => { cursor = nextCursor; void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); controller?.abort(); }
    else void refresh();
  });
  window.addEventListener('pagehide', () => { clearTimeout(timer); controller?.abort(); });
  void (async () => {
    try {
      const info = await request('/status', AbortSignal.timeout(8000));
      enabled = info.enabled;
      byId('cockpit-link').hidden = info.monitorOnly;
      byId('signout-link').hidden = info.publicRead === true;
      byId('public-read-note').hidden = info.publicRead !== true;
      if (enabled) await refresh();
      else {
        byId('connection').textContent = 'External session source is not configured. Ask the server owner to configure it.';
        byId('runs').replaceChildren(node('p', 'No source connected.', 'empty'));
        byId('refresh').disabled = true;
      }
    } catch (error) { byId('connection').textContent = error.message; byId('connection').className = 'error'; }
  })();
})();
