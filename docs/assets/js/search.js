// 中文/英文双语搜索增强版 search.js（无外部分词依赖）
// 说明：
// - 运行时抓取页面 HTML，抽取可见中文与 data-en 英文文案，构建双语索引
// - 采用“CJK 单字 + 非中文连续片段”的轻量级分词，配合 lunr 的英文分词兜底
// - 强制重置 lunr 的默认英文 pipeline，避免丢弃中文 token
// - 根据当前语言优先展示对应语言标题与摘要（支持 URL ?lang= 覆盖、本地偏好 preferred-language、<html lang>）

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var urlParams = new URLSearchParams(window.location.search);
    var query = urlParams.get('q') || '';
    var resultsContainer = document.getElementById('search-results');
    var baseurl = (window.SITE_BASEURL || '').replace(/\/$/, '');

    // 转义正则关键字符
    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 当前语言：URL 覆盖 > 本地存储 > <html lang>
    function getCurrentLang() {
      var p = new URLSearchParams(window.location.search).get('lang');
      if (p === 'zh' || p === 'en') return p;
      var ls = (function(){ try { return localStorage.getItem('preferred-language'); } catch(e){ return null; }})();
      if (ls === 'zh' || ls === 'en') return ls;
      var htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
      if (htmlLang.indexOf('zh') === 0) return 'zh';
      if (htmlLang.indexOf('en') === 0) return 'en';
      return 'zh';
    }

    // 轻量级分词：将中文按单字切分，非中文按连续片段切分（保留英文词汇）
    function segmentText(text) {
      if (!text) return [];
      // 优先尝试 lunr 自带的 tokenizer（对英文友好）
      try {
        if (window.lunr && typeof window.lunr.tokenizer === 'function') {
          var tokens = window.lunr.tokenizer(text).map(function (t) { return t && t.toString ? t.toString() : String(t); });
          if (tokens && tokens.length) return tokens;
        }
      } catch (e) {}
      // 兜底：CJK 单字 + 非中文连续片段
      var parts = [];
      var re = /[\u4E00-\u9FFF]|[^\u4E00-\u9FFF\s]+/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        parts.push(m[0]);
      }
      return parts;
    }

    // 从 HTML 字符串提取中英文内容
    function extractPageLangContent(html, url) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');

      // 过滤 script/style 等，仅取 body 文本作为中文可见内容
      function getVisibleText(root) {
        if (!root) return '';
        // 克隆一份，移除脚本与样式
        var clone = root.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(function (el) { el.remove(); });
        // 一些导航/页脚噪声可按需剔除（保持简单）
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }

      var contentZh = getVisibleText(doc.body);

      // 收集 data-en 英文内容
      var enPieces = [];
      doc.querySelectorAll('[data-en]').forEach(function (el) {
        var v = el.getAttribute('data-en');
        if (v) enPieces.push(v);
      });
      var contentEn = enPieces.join(' ').replace(/\s+/g, ' ').trim();

      // 标题优先取带 data-zh/data-en 的主标题，其次 <title> 或首个 h1
      var titleEl = doc.querySelector('.article-title[data-zh][data-en]') || doc.querySelector('[data-zh][data-en]') || doc.querySelector('h1');
      var titleZh = '';
      var titleEn = '';
      if (titleEl) {
        titleZh = titleEl.getAttribute('data-zh') || (titleEl.textContent || '').trim();
        titleEn = titleEl.getAttribute('data-en') || '';
      }
      if (!titleZh) titleZh = (doc.title || '').trim() || url;
      if (!titleEn) {
        var tEnMeta = doc.querySelector('meta[property="og:title"][content]');
        if (tEnMeta) titleEn = tEnMeta.getAttribute('content') || '';
      }

      return {
        url: url,
        title_zh: titleZh,
        title_en: titleEn,
        content_zh: contentZh,
        content_en: contentEn
      };
    }

    // 带超时的 fetch
    function fetchWithTimeout(input, init, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('Fetch timeout')); }, timeoutMs || 12000);
        fetch(input, init).then(function (res) { clearTimeout(timer); resolve(res); }, function (err) { clearTimeout(timer); reject(err); });
      });
    }

    // 并发控制
    function runWithConcurrency(items, worker, limit) {
      return new Promise(function (resolve) {
        var index = 0; var running = 0; var results = new Array(items.length);
        function next() {
          if (index >= items.length && running === 0) return resolve(results);
          while (running < limit && index < items.length) {
            (function (i) {
              running++;
              Promise.resolve(worker(items[i], i)).then(function (r) {
                results[i] = r; running--; next();
              }).catch(function () { results[i] = null; running--; next(); });
            })(index++);
          }
        }
        next();
      });
    }

    // 基于 search.json 的 URL 列表抓取页面 HTML 并抽取双语内容，带本地缓存
    function buildDocsWithHTML(baseurl, list) {
      var CACHE_KEY = 'SEARCH_DOCS_V3';
      var CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
      var now = Date.now();
      try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          var parsed = JSON.parse(cached);
          if (parsed && parsed.time && (now - parsed.time) < CACHE_TTL_MS && parsed.docs && parsed.docs.length >= (list ? list.length * 0.6 : 0)) {
            return Promise.resolve(parsed.docs);
          }
        }
      } catch (e) {}

      var urls = (list || []).map(function (it) { return it.url; });
      // 过滤 search 自己
      urls = urls.filter(function (u) { return !(u || '').includes('/search/'); });

      return runWithConcurrency(urls, function (u) {
        var full = u.startsWith('http') ? u : (baseurl + u);
        return fetchWithTimeout(full, { credentials: 'same-origin' }, 12000)
          .then(function (res) { return res.text(); })
          .then(function (html) { return extractPageLangContent(html, u); })
          .catch(function () { return { url: u, title_zh: u, title_en: '', content_zh: '', content_en: '' }; });
      }, 4).then(function (docs) {
        // 合并中英文到通用字段，供索引使用
        var merged = docs.map(function (d) {
          var title = [d.title_zh, d.title_en].filter(Boolean).join(' ');
          var content = [d.content_zh, d.content_en].filter(Boolean).join(' ');
          return Object.assign({}, d, { title: title, content: content });
        });
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ time: now, docs: merged })); } catch (e) {}
        return merged;
      });
    }

    function buildIndex(docs) {
      return lunr(function () {
        // 强制禁用默认英文 pipeline，避免丢中文 token
        this.pipeline.reset();
        this.searchPipeline.reset();

        this.ref('url');
        this.field('title', { boost: 5 });
        this.field('content');

        docs.forEach(function (doc) {
          this.add({
            url: doc.url,
            title: segmentText(doc.title).join(' '),
            content: segmentText(doc.content).join(' ')
          });
        }, this);
      });
    }

    // 根据当前语言渲染标题与摘要（优先当前语言，缺失则回退）
    function renderResults(results, data, queryText) {
      if (!resultsContainer) return;
      if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<p>未找到结果 / No results found.</p>';
        return;
      }

      var currentLang = getCurrentLang();
      var tokens = segmentText(queryText).filter(function (t) { return t && t.trim(); });
      var highlightRe = tokens.length ? new RegExp('(' + tokens.map(escapeRegExp).join('|') + ')', 'gi') : null;

      var html = '<ul class="search-list">';
      results.forEach(function (res) {
        var item = data.find(function (d) { return d.url === res.ref; });
        if (!item) return;

        var titleRaw = currentLang === 'en' ? (item.title_en || item.title_zh || item.title) : (item.title_zh || item.title_en || item.title);
        var contentRaw = currentLang === 'en' ? (item.content_en || item.content_zh || '') : (item.content_zh || item.content_en || '');

        var title = titleRaw || item.url;
        var content = (contentRaw || '').replace(/\s+/g, ' ').trim();

        // 生成摘要：尽量截取出现首个查询词附近的片段
        var snippet = '';
        if (tokens.length) {
          var idx = -1;
          for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i];
            var re = new RegExp(escapeRegExp(t), 'i');
            var m = re.exec(content);
            if (m) { idx = m.index; break; }
          }
          if (idx >= 0) {
            var start = Math.max(0, idx - 40);
            snippet = content.slice(start, start + 160);
            if (start > 0) snippet = '…' + snippet;
            if (start + 160 < content.length) snippet += '…';
          }
        }
        if (!snippet) snippet = content.slice(0, 140) + (content.length > 140 ? '…' : '');

        if (highlightRe) {
          title = title.replace(highlightRe, '<mark>$1</mark>');
          snippet = snippet.replace(highlightRe, '<mark>$1</mark>');
        }

        html += '<li class="search-item">' +
          '<a href="' + item.url + '"><strong>' + title + '</strong></a>' +
          (snippet ? '<div class="snippet">' + snippet + '</div>' : '') +
        '</li>';
      });
      html += '</ul>';
      resultsContainer.innerHTML = html;
    }

    function doSearch() {
      if (!query) {
        if (resultsContainer) resultsContainer.innerHTML = '<p>请输入关键词 / Please enter a keyword.</p>';
        return;
      }

      if (resultsContainer) resultsContainer.innerHTML = '<p>正在构建索引 / Building index…</p>';

      fetch(baseurl + '/search.json')
        .then(function (response) { return response.json(); })
        .then(function (data) {
          // data: [{ title, url, content }] — 我们仅使用 url 列表，实际内容以页面 HTML 抽取为准
          return buildDocsWithHTML(baseurl, data);
        })
        .then(function (docs) {
          var idx = buildIndex(docs);
          var tokenizedQuery = segmentText(query).join(' ');
          var results;
          try {
            results = idx.search(tokenizedQuery || query);
          } catch (e) {
            try { results = idx.search(query); } catch (e2) { results = []; }
          }
          renderResults(results, docs, query);
        })
        .catch(function (err) {
          console.error('Search error:', err);
          if (resultsContainer) resultsContainer.innerHTML = '<p>搜索服务暂不可用 / Search is temporarily unavailable.</p>';
        });
    }

    doSearch();
  });
})();