export const iconNames = [
  "arrow-up-right", "book-open", "car", "check", "chevron-down", "chevron-left", "chevron-right",
  "clipboard-check", "clock-3", "external-link", "layout-grid", "list", "map-pin", "menu", "rotate-ccw", "shield-alert", "x", "zoom-in",
];

export function icon(name) {
  if (!iconNames.includes(name)) throw new Error(`Unknown icon: ${name}`);
  return `<i class="ui-icon" style="--icon-url: url('assets/icons/${name}.svg')" aria-hidden="true"></i>`;
}
