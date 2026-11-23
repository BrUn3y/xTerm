const preview = document.querySelector("#workspace-preview");
const previewLink = preview.closest("a");
const previewCaption = document.querySelector("#preview-caption");
const appearances = {
  light: {
    source: "assets/xterm-light.webp",
    alt: "xTerm in Light mode, with a real zsh session, the orange Make It Happen poster, and the built-in file explorer.",
    caption: "xTerm in Light mode — your terminal and files, side by side.",
    label: "PAPER. ORANGE. POSSIBILITIES.",
  },
  dark: {
    source: "assets/xterm-dark.webp",
    alt: "The same xTerm workspace in Dark mode, with a carbon terminal, orange accents, and the built-in file explorer.",
    caption:
      "xTerm in Dark mode — the same workspace, a different point of view.",
    label: "CARBON. ORANGE. POSSIBILITIES.",
  },
};

document.querySelector(".appearance-switch").hidden = false;
document.querySelectorAll("[data-appearance]").forEach((button) => {
  button.addEventListener("click", () => {
    const appearance = appearances[button.dataset.appearance];
    preview.src = appearance.source;
    preview.alt = appearance.alt;
    previewLink.href = appearance.source;
    previewLink.dataset.caption = appearance.caption;
    previewCaption.textContent = appearance.label;
    document.querySelectorAll("[data-appearance]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
  });
});

const dialog = document.querySelector(".image-dialog");
const expandedImage = document.querySelector("#expanded-image");
const expandedCaption = document.querySelector("#image-dialog-caption");

if (typeof dialog.showModal === "function") {
  document.querySelectorAll("[data-zoom]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      expandedImage.src = link.href;
      expandedImage.alt = link.querySelector("img").alt;
      expandedCaption.textContent = link.dataset.caption;
      dialog.showModal();
      document.documentElement.classList.add("dialog-open");
    });
  });
  document
    .querySelector("#close-image")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("close", () =>
    document.documentElement.classList.remove("dialog-open"),
  );
}
