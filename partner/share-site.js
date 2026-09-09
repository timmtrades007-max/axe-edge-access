(function () {
  function pageUrl() {
    return window.location.href.split("#")[0];
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function toast(msg) {
    var el = document.getElementById("shareToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var copyBtn = document.getElementById("shareCopyLink");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyText(pageUrl())
          .then(function () {
            toast("Link copied");
          })
          .catch(function () {
            toast("Copy failed - select URL from address bar");
          });
      });
    }

    var waBtn = document.getElementById("shareWhatsApp");
    if (waBtn) {
      waBtn.addEventListener("click", function () {
        var text =
          "Axe Edge Access - verified backtest proof + live equity replay: " + pageUrl();
        window.open(
          "https://wa.me/?text=" + encodeURIComponent(text),
          "_blank",
          "noopener,noreferrer"
        );
      });
    }
  });
})();
