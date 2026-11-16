import catalog from "../../../backend/internal/prompts/character_reference_templates.json";

export const CHARACTER_REFERENCE_LAYOUTS = catalog.layouts;
export const CHARACTER_DESIGN_TEMPLATES = catalog.designs;
export const DEFAULT_CHARACTER_REFERENCE_LAYOUT = "portrait-body-grid";
export const DEFAULT_CHARACTER_DESIGN_TEMPLATE = "project-style";

export function characterReferenceLayout(id?: string) {
    return CHARACTER_REFERENCE_LAYOUTS.find((item) => item.id === id) || CHARACTER_REFERENCE_LAYOUTS[0]!;
}

export function characterDesignTemplate(id?: string) {
    return CHARACTER_DESIGN_TEMPLATES.find((item) => item.id === id) || CHARACTER_DESIGN_TEMPLATES[0]!;
}
