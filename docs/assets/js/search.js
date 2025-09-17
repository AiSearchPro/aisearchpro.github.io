document.addEventListener('DOMContentLoaded', function () {
  var urlParams = new URLSearchParams(window.location.search);
  var query = urlParams.get('q');

  if (query) {
    fetch('/search.json')
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var idx = lunr(function () {
          this.ref('url');
          this.field('title');
          this.field('content');

          data.forEach(function (doc) {
            this.add(doc);
          }, this);
        });

        var results = idx.search(query);
        var resultsContainer = document.getElementById('search-results');

        if (results.length) {
          var resultList = '<ul>';
          results.forEach(function (result) {
            var item = data.find(function (item) {
              return item.url === result.ref;
            });
            resultList += '<li><a href="' + item.url + '">' + item.title + '</a></li>';
          });
          resultList += '</ul>';
          resultsContainer.innerHTML = resultList;
        } else {
          resultsContainer.innerHTML = 'No results found.';
        }
      });
  }
});