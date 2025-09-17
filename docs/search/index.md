---
layout: home
content_only: true
---

<div class="collection-article">
  <h1 data-zh="搜索结果" data-en="Search Results">搜索结果</h1>
  <p><a href="javascript:history.back()" data-zh="&larr; 返回上一页" data-en="&larr; Go Back">&larr; 返回上一页</a></p>
  <div id="search-results"></div>
</div>

<script src="https://unpkg.com/lunr/lunr.min.js"></script>
<!-- 引入 lunr.js 中文语言包（可选） -->
<script src="https://unpkg.com/lunr-languages/lunr.stemmer.support.js"></script>
<script src="https://unpkg.com/lunr-languages/lunr.zh.js"></script>

<!-- 将 Jekyll 的 baseurl 注入到前端 -->
<script>window.SITE_BASEURL = "{{ site.baseurl | default: '' }}";</script>

<!-- 为避免缓存旧版脚本，添加时间戳参数 -->
<script src="{{ site.baseurl }}/assets/js/search.js?v={{ site.time | date: '%s' }}"></script>