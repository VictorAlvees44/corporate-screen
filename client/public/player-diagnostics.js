/* Mantém a tela ativa durante a exibição. Compatível com ES5 e sem efeito no painel. */
(function (root) {
  'use strict';
  var state = { supported: false, active: false, method: 'none', error: '' };
  var desired = false;
  var requesting = false;
  var sentinel = null;
  var navigatorValue = root.navigator || {};
  var canWakeLock = Boolean(navigatorValue.wakeLock && typeof navigatorValue.wakeLock.request === 'function');
  var appCommon = root.webapis && root.webapis.appcommon;
  var canTizen = Boolean(appCommon && appCommon.AppCommonScreenSaverState && typeof appCommon.setScreenSaver === 'function');
  var isPlayer = root.location && /^(?:\/|\/player\/?|\/player-legacy\/?|\/player-legacy\.html)$/.test(root.location.pathname || '');
  state.supported = canWakeLock || canTizen;

  function copyState() {
    return { supported: state.supported, active: state.active, method: state.method, error: state.error };
  }
  function releaseStandard() {
    var current = sentinel;
    sentinel = null;
    if (current && typeof current.release === 'function') {
      try { var released = current.release(); if (released && released.catch) released.catch(function () {}); } catch (error) { void error; }
    }
    if (state.method === 'screen-wake-lock') state.active = false;
  }
  function setTizen(enabled) {
    if (!canTizen) return false;
    try {
      var value = enabled ? appCommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF : appCommon.AppCommonScreenSaverState.SCREEN_SAVER_ON;
      appCommon.setScreenSaver(value, function () {
        state.active = enabled;
        state.method = enabled ? 'tizen-screensaver' : 'none';
        state.error = '';
      }, function () {
        state.active = false;
        state.method = 'tizen-screensaver';
        state.error = 'REQUEST_FAILED';
      });
      return true;
    } catch (error) {
      void error;
      state.active = false;
      state.method = 'tizen-screensaver';
      state.error = 'REQUEST_FAILED';
      return false;
    }
  }
  function acquire() {
    if (!isPlayer || !desired || requesting || state.active || (root.document && root.document.hidden)) return;
    if (!canWakeLock) { setTizen(true); return; }
    requesting = true;
    state.method = 'screen-wake-lock';
    try {
      var result = navigatorValue.wakeLock.request('screen');
      if (!result || typeof result.then !== 'function') throw new Error('Wake lock sem Promise');
      result.then(function (lock) {
        requesting = false;
        if (!desired) { try { lock.release(); } catch (error) { void error; } return; }
        sentinel = lock;
        state.active = true;
        state.error = '';
        if (lock.addEventListener) lock.addEventListener('release', function () {
          if (sentinel === lock) sentinel = null;
          state.active = false;
          if (desired && (!root.document || !root.document.hidden)) root.setTimeout(acquire, 3000);
        });
      }).catch(function (error) {
        requesting = false;
        state.active = false;
        state.error = error && error.name === 'NotAllowedError' ? 'NOT_ALLOWED' : 'REQUEST_FAILED';
        if (canTizen) setTizen(true);
      });
    } catch (error) {
      void error;
      requesting = false;
      state.active = false;
      state.error = 'REQUEST_FAILED';
      if (canTizen) setTizen(true);
    }
  }
  function release() {
    releaseStandard();
    if (state.method === 'tizen-screensaver') setTizen(false);
  }
  root.CorporateScreenPower = {
    setDesired: function (value) { desired = value === true; if (desired) acquire(); else release(); },
    request: acquire,
    snapshot: copyState
  };
  if (!isPlayer) return;
  function visibilityChanged() {
    if (root.document && root.document.hidden) release();
    else acquire();
  }
  if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', visibilityChanged, false);
  if (root.addEventListener) {
    root.addEventListener('focus', acquire, false);
    root.addEventListener('pageshow', acquire, false);
    root.addEventListener('pagehide', release, false);
    root.addEventListener('beforeunload', release, false);
  }
}(window));

/* Diagnóstico compartilhado pelos players moderno e legado. Manter ES5. */
(function (root) {
  'use strict';
  function capabilities() {
    var video = root.document ? root.document.createElement('video') : {};
    var storage = 'none';
    try { var key = 'corporate-screen.storage-test'; root.localStorage.setItem(key, '1'); if (root.localStorage.getItem(key) === '1') storage = 'local'; root.localStorage.removeItem(key); } catch (error) { void error; }
    function codec(mime) { try { return video.canPlayType ? (video.canPlayType(mime) || 'no') : 'no'; } catch (error) { void error; return 'no'; } }
    return { video: typeof video.play === 'function', mp4: codec('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'), webm: codec('video/webm; codecs="vp8, vorbis"'), storage: storage, xhr: Boolean(root.XMLHttpRequest), json: Boolean(root.JSON) };
  }
  root.CorporateScreenDiagnostics = {
    capabilities: capabilities,
    create: function () {
      var state = { version: '2026-09-11.1', state: 'loading', playlistId: '', itemId: '', mediaName: '', receivedSync: '', offline: false, errorCode: '', diagnostics: { checkedRequest: '', capabilities: capabilities(), network: { samples: 0, lastMs: 0, averageMs: 0, failures: 0, networkFailures: 0, consecutiveFailures: 0, lastHttpStatus: 0 }, media: { loadMs: null, stalls: 0 }, power: power() } };
      var samples = [];
      var errorSequence = 0;
      var beforeNetwork = 'loading';
      var boot = new Date().getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      function name(url) {
        var value = String(url || '').split(/[?#]/)[0].split('/').pop();
        try { value = decodeURIComponent(value); } catch (error) { void error; }
        return value.slice(0, 160);
      }
      function fail(code, mediaName) {
        // A ocorrência fica no próximo relatório mesmo se outro slide já abriu.
        if (state.errorCode !== code || state.mediaName !== mediaName) {
          errorSequence += 1;
          state.lastError = { id: boot + '-' + errorSequence, code: code, mediaName: mediaName || state.mediaName };
        }
        state.state = 'error'; state.errorCode = code;
      }
      function good(value) { state.state = value; state.errorCode = ''; }
      function power() {
        return root.CorporateScreenPower && root.CorporateScreenPower.snapshot
          ? root.CorporateScreenPower.snapshot()
          : { supported: false, active: false, method: 'none', error: '' };
      }
      return {
        snapshot: function () { state.diagnostics.power = power(); return JSON.parse(JSON.stringify(state)); },
        fail: fail,
        requestSample: function (ms, httpStatus) {
          samples.push({ ms: Math.max(0, Math.min(120000, ms)), status: httpStatus });
          if (samples.length > 20) samples.shift();
          var ok = 0; var total = 0; var failed = 0; var networkFailed = 0;
          for (var index = 0; index < samples.length; index += 1) {
            if (samples[index].status >= 200 && samples[index].status < 300) { total += samples[index].ms; ok += 1; } else failed += 1;
            if (samples[index].status === 0) networkFailed += 1;
          }
          var previous = state.diagnostics.network;
          state.diagnostics.network = { samples: samples.length, lastMs: Math.round(ms), averageMs: ok ? Math.round(total / ok) : 0, failures: failed, networkFailures: networkFailed, consecutiveFailures: httpStatus >= 200 && httpStatus < 300 ? 0 : previous.consecutiveFailures + 1, lastHttpStatus: httpStatus };
        },
        content: function (data, changed, offline) {
          state.offline = offline === true;
          if (!offline && state.errorCode === 'CONTENT_FETCH') good(beforeNetwork);
          if (!offline) state.receivedSync = data.atualizacaoPlayersEm || '';
          if (!offline && data.tv && data.tv.diagnosticoSolicitadoEm && data.tv.diagnosticoSolicitadoEm !== state.diagnostics.checkedRequest) {
            state.diagnostics.capabilities = capabilities();
            state.diagnostics.power = power();
            state.diagnostics.checkedRequest = data.tv.diagnosticoSolicitadoEm;
          }
          state.playlistId = data.playlist ? data.playlist.id : '';
          var idle = data.pendenteAprovacao ? 'pending' : data.dentroHorarioOperacional === false ? 'standby' : null;
          if (!idle && (!data.playlist || !data.playlist.itens.length)) idle = data.layout ? 'layout' : 'empty';
          if (idle) { good(idle); state.itemId = ''; state.mediaName = ''; }
          else if (changed) { good('loading'); state.itemId = ''; state.mediaName = ''; }
        },
        network: function () { if (!state.offline) beforeNetwork = state.state; state.offline = true; fail('CONTENT_FETCH', state.mediaName); },
        watch: function (element, item) {
          var stopped = false;
          var started = new Date().getTime();
          var lastProgress = started;
          var lastPosition = Number(element.currentTime) || 0;
          var loadDeadline = item.tipo === 'imagem' ? Math.min(30000, Math.max(2000, (Number(item.tempoExibicao) || 30) * 1000 - 1000)) : 30000;
          var loaded = false;
          var file = name(item.arquivo);
          var events = [];
          state.itemId = item.id || ''; state.mediaName = file; good('loading');
          function listen(event, fn) {
            if (element.addEventListener) element.addEventListener(event, fn, false);
            else if (element.attachEvent) element.attachEvent('on' + event, fn);
            events.push([event, fn]);
          }
          state.diagnostics.media.loadMs = null;
          function ready() { if (!stopped) { if (!loaded) state.diagnostics.media.loadMs = new Date().getTime() - started; loaded = true; lastProgress = new Date().getTime(); good(item.tipo === 'link' ? 'external' : 'playing'); } }
          function error() {
            if (stopped) return;
            var code = element.error ? element.error.code : 0;
            fail(item.tipo === 'imagem' ? 'IMAGE_LOAD' : item.tipo === 'link' ? 'FRAME_LOAD' : ({ 1: 'MEDIA_ABORTED', 2: 'VIDEO_NETWORK', 3: 'VIDEO_DECODE', 4: 'VIDEO_FORMAT' }[code] || 'MEDIA_LOAD'), file);
          }
          listen('error', error);
          if (item.tipo === 'video') {
            if (typeof element.play !== 'function') fail('VIDEO_UNSUPPORTED', file);
            listen('waiting', function () { state.diagnostics.media.stalls += 1; });
            listen('playing', ready);
            listen('timeupdate', function () {
              if (element.currentTime !== lastPosition) { lastPosition = element.currentTime; ready(); }
            });
            // Alguns aparelhos não emitem `error` quando bloqueiam autoplay.
            try {
              var playResult = typeof element.play === 'function' ? element.play() : null;
              if (playResult && playResult.catch) playResult.catch(function (errorValue) {
                if (!stopped && errorValue && errorValue.name !== 'AbortError') fail(errorValue.name === 'NotAllowedError' ? 'AUTOPLAY_BLOCKED' : 'VIDEO_FORMAT', file);
              });
            } catch (error) { void error; fail('VIDEO_FORMAT', file); }
          } else {
            listen('load', ready);
            if (item.tipo === 'imagem' && element.complete) { if (element.naturalWidth > 0) ready(); else error(); }
            // Um iframe pode disparar load mesmo bloqueado: nunca o chamamos
            // de reprodução confirmada. Não podemos inspecionar outra origem.
            if (item.tipo === 'link') good('external');
          }
          var timer = root.setInterval(function () {
            var now = new Date().getTime();
            if (!loaded && now - started >= loadDeadline && item.tipo !== 'link' && !state.errorCode) fail('MEDIA_TIMEOUT', file);
            if (loaded && item.tipo === 'video' && !element.ended && now - lastProgress >= 30000) fail('VIDEO_STALLED', file);
          }, 1000);
          return function () {
            stopped = true; root.clearInterval(timer);
            for (var i = 0; i < events.length; i += 1) {
              if (element.removeEventListener) element.removeEventListener(events[i][0], events[i][1], false);
              else if (element.detachEvent) element.detachEvent('on' + events[i][0], events[i][1]);
            }
          };
        }
      };
    }
  };
}(window));
