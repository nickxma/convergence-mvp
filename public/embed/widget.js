/* Paradox of Acceptance — Q&A embed widget
 * Usage: <script src="/embed/widget.js" data-site-id="my-site" data-theme="light"></script>
 * Attributes:
 *   data-site-id        Identifier for your site (for analytics)
 *   data-placeholder    Input placeholder text
 *   data-theme          "light" or "dark" (default: "light")
 *   data-max-height     Max iframe height in px (default: 600)
 */
(function () {
  'use strict';

  // Find this script tag by looking for widget.js in src
  var scripts = document.querySelectorAll('script[src]');
  var scriptTag = null;
  for (var i = scripts.length - 1; i >= 0; i--) {
    if (scripts[i].src && scripts[i].src.indexOf('/embed/widget.js') !== -1) {
      scriptTag = scripts[i];
      break;
    }
  }
  if (!scriptTag) return;

  // Determine base URL from script's own src attribute
  var src = scriptTag.src; // absolute URL, e.g. https://domain.com/embed/widget.js
  var embedIndex = src.indexOf('/embed/widget.js');
  var baseUrl = embedIndex > 0 ? src.substring(0, embedIndex) : '';

  // Read data attributes
  var siteId = scriptTag.getAttribute('data-site-id') || '';
  var placeholder = scriptTag.getAttribute('data-placeholder') || '';
  var theme = scriptTag.getAttribute('data-theme') || 'light';
  var maxHeightAttr = scriptTag.getAttribute('data-max-height') || '600';
  var maxHeight = parseInt(maxHeightAttr, 10) || 600;

  // Build iframe URL
  var qs = [];
  if (siteId) qs.push('siteId=' + encodeURIComponent(siteId));
  if (placeholder) qs.push('placeholder=' + encodeURIComponent(placeholder));
  qs.push('theme=' + encodeURIComponent(theme));
  var iframeSrc = baseUrl + '/embed/ask' + (qs.length ? '?' + qs.join('&') : '');

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.title = 'Ask anything — powered by Paradox of Acceptance';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('scrolling', 'no');
  iframe.style.cssText = [
    'width:100%',
    'border:0',
    'display:block',
    'height:' + maxHeight + 'px',
    'overflow:hidden',
    'transition:height 0.2s ease',
  ].join(';');

  // Auto-resize: the embed page sends postMessage with its scrollHeight
  window.addEventListener('message', function (evt) {
    try {
      if (evt.source !== iframe.contentWindow) return;
      var msg = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
      if (msg && msg.type === 'poa-embed-resize' && typeof msg.height === 'number') {
        var newHeight = Math.min(msg.height + 16, maxHeight);
        if (newHeight > 80) iframe.style.height = newHeight + 'px';
      }
    } catch (_) {}
  });

  // Wrap and inject after script tag
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'width:100%;overflow:hidden;';
  wrapper.appendChild(iframe);
  if (scriptTag.parentNode) {
    scriptTag.parentNode.insertBefore(wrapper, scriptTag.nextSibling);
  }
})();
