
  // Remove cloak ONLY when everything is fully parsed and rendered
  window.onload = () => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('fouc-cloak');
      document.body.classList.remove('fouc-cloak');
    });
  };
  // Ultimate fallback just in case
  setTimeout(() => {
      document.documentElement.classList.remove('fouc-cloak');
      document.body.classList.remove('fouc-cloak');
  }, 2000);
