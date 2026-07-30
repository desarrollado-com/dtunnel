/** Resalta sección activa en el índice al hacer scroll */
(function () {
  const links = document.querySelectorAll('.docs-toc a');
  const sections = Array.from(links).map((a) => {
    const id = a.getAttribute('href')?.slice(1);
    return { link: a, el: id ? document.getElementById(id) : null };
  }).filter((s) => s.el);

  function onScroll() {
    const y = window.scrollY + 100;
    let current = sections[0];
    for (const s of sections) {
      if (s.el.offsetTop <= y) current = s;
    }
    links.forEach((l) => l.classList.remove('active'));
    if (current) current.link.classList.add('active');
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
