// 中文搜索增强版 search.js（无外部分词依赖）
// 说明：
// - 由于外链分词脚本可能被浏览器 ORB 策略阻止，移除对 jieba 的依赖
// - 采用“CJK 单字 + 非中文连续片段”的轻量级分词，配合 lunr 的英文分词兜底
// - 强制重置 lunr 的默认英文 pipeline，避免丢弃中文 token
// - 对查询同样按上述规则分词，并提供结果高亮

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

    // 轻量级分词：将中文按单字切分，非中文按连续片段切分
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

    function buildIndex(docs) {
      return lunr(function () {
        // 强制禁用默认英文 pipeline，避免丢中文 token
        this.pipeline.reset();
        this.searchPipeline.reset();

        this.ref('url');
        this.field('title');
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

    function renderResults(results, data, queryText) {
      if (!resultsContainer) return;
      if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<p>未找到结果 / No results found.</p>';
        return;
      }

      var tokens = segmentText(queryText).filter(function (t) { return t && t.trim(); });
      var highlightRe = tokens.length ? new RegExp('(' + tokens.map(escapeRegExp).join('|') + ')', 'gi') : null;

      var html = '<ul class="search-list">';
      results.forEach(function (res) {
        var item = data.find(function (d) { return d.url === res.ref; });
        if (!item) return;
        var title = item.title || item.url;
        var content = (item.content || '').replace(/\s+/g, ' ').trim();
        var snippet = content.slice(0, 140);
        if (highlightRe) {
          title = title.replace(highlightRe, '<mark>$1</mark>');
          snippet = snippet.replace(highlightRe, '<mark>$1</mark>');
        }
        html += '<li class="search-item">' +
          '<a href="' + item.url + '"><strong>' + title + '</strong></a>' +
          (snippet ? '<div class="snippet">' + snippet + (content.length > 140 ? '…' : '') + '</div>' : '') +
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

      fetch(baseurl + '/search.json')
        .then(function (response) { return response.json(); })
        .then(function (data) {
          var idx = buildIndex(data);
          var tokenizedQuery = segmentText(query).join(' ');
          var results;
          try {
            results = idx.search(tokenizedQuery || query);
          } catch (e) {
            try { results = idx.search(query); } catch (e2) { results = []; }
          }
          renderResults(results, data, query);
        })
        .catch(function (err) {
          console.error('Search error:', err);
          if (resultsContainer) resultsContainer.innerHTML = '<p>搜索服务暂不可用 / Search is temporarily unavailable.</p>';
        });
    }

    doSearch();
  });
})();