export const maintenanceTemplates = {
  en: {
    subject: "Maintenance {{number}}: {{status}}",
    body: "{{title}} — {{status}}. {{note}}",
  },
  ur: {
    subject: "مرمت {{number}}: {{status}}",
    body: "{{title}} — {{status}}۔ {{note}}",
  },
};
export function renderTemplate(text: string, values: Record<string, string>) {
  return text.replace(
    /\{\{(number|status|title|note)\}\}/g,
    (_, key: string) => values[key] || "",
  );
}
