const themeImage = document.querySelector('#theme-image');
const themeImageLink = document.querySelector('#theme-image-link');
const themeCaption = document.querySelector('#theme-caption');

if (themeImage && themeImageLink && themeCaption) {
  const choices = [];

  for (const link of document.querySelectorAll('.theme-choice')) {
    const button = document.createElement('button');
    const imagePath = link.getAttribute('href');
    const description = link.dataset.description;
    const title = link.textContent.trim();

    button.type = 'button';
    button.className = link.className;
    button.dataset.theme = link.dataset.theme;
    button.setAttribute('aria-pressed', String(link.hasAttribute('aria-current')));
    button.setAttribute('aria-controls', 'theme-image');
    button.append(...link.childNodes);
    link.replaceWith(button);
    choices.push(button);

    button.addEventListener('click', () => {
      themeImage.src = imagePath;
      themeImage.alt = `${title}: ${description}`;
      themeImageLink.href = imagePath;
      themeCaption.querySelector('strong').textContent = title;
      themeCaption.querySelector('span').textContent = description;
      for (const choice of choices) {
        choice.setAttribute('aria-pressed', String(choice === button));
      }
    });
  }
}
