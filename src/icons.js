export const iconNames = [
  "book-open", "car", "check", "chevron-left", "chevron-right",
  "clipboard-check", "clock-3", "layout-grid", "list", "map-pin", "menu", "rotate-ccw", "shield-alert", "x",
];

export function icon(name) {
  if (!iconNames.includes(name)) throw new Error(`Unknown icon: ${name}`);
  return `<i class="ui-icon" style="--icon-url: url('assets/icons/${name}.svg')" aria-hidden="true"></i>`;
}
