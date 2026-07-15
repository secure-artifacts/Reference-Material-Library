/* ==== CSP-COMPLIANT EVENT DELEGATION DISPATCHER ====
   MV3 扩展页面的默认 CSP（script-src 'self'）禁止内联事件处理器（onclick="..." 等）。
   原网页版所有 on* 属性已在打包脚本中自动转换为 data-act / data-evt / data-act-args，
   本文件负责在真实事件触发时，找到对应的处理函数（定义于 handlers.js）并以相同的参数、
   相同的 this 指向去调用它，行为与原来的内联属性完全一致。
*/
(function () {
  var BUBBLING_EVENTS = ['click', 'dblclick', 'contextmenu', 'mousedown', 'change',
                          'drop', 'dragstart', 'dragover', 'dragend', 'keydown'];
  var CAPTURE_ONLY_EVENTS = ['input', 'error', 'blur']; // 这些事件不冒泡，需要用捕获阶段委托

  // 部分元素需要同时绑定多个事件（如卡片同时需要 click / dblclick / contextmenu / drag*）。
  // 若都使用同名的 data-act / data-evt 属性，HTML 解析器只会保留第一次出现的属性值，
  // 后面重复的属性会被浏览器静默丢弃，导致除第一个事件外全部失效。
  // 因此第 2 个及以后的事件改用带编号的属性：data-evt2/data-act2/data-act-args2，
  // data-evt3/data-act3/data-act-args3 ……以此类推，编号最多支持到 9。
  var MAX_SUFFIX = 9;

  function findBinding(target, evtType) {
    var el = target;
    while (el) {
      if (el.getAttribute) {
        if (el.getAttribute('data-evt') === evtType && el.hasAttribute('data-act')) {
          return { el: el, suffix: '' };
        }
        for (var i = 2; i <= MAX_SUFFIX; i++) {
          if (el.getAttribute('data-evt' + i) === evtType && el.hasAttribute('data-act' + i)) {
            return { el: el, suffix: String(i) };
          }
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function dispatch(evtType, e) {
    var binding = findBinding(e.target, evtType);
    if (!binding) return;
    var el = binding.el, suf = binding.suffix;
    var name = el.getAttribute('data-act' + suf);
    var fn = window.__Handlers && window.__Handlers[name];
    if (typeof fn !== 'function') { return; }
    var argsAttr = el.getAttribute('data-act-args' + suf) || '[]';
    var args = [];
    try {
      args = JSON.parse(argsAttr.replace(/&quot;/g, '"'));
    } catch (err) {
      console.error('data-act-args parse failed for', name, argsAttr, err);
    }
    try {
      fn.apply(el, [e].concat(args));
    } catch (err) {
      console.error('handler', name, 'threw', err);
    }
  }

  BUBBLING_EVENTS.forEach(function (evtType) {
    document.addEventListener(evtType, function (e) { dispatch(evtType, e); }, false);
  });
  CAPTURE_ONLY_EVENTS.forEach(function (evtType) {
    document.addEventListener(evtType, function (e) { dispatch(evtType, e); }, true);
  });
})();
