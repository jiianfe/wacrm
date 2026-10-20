/**
 * Tags and custom fields describe companies in this B2B setup (see
 * migration 063), so the contact screens hide them. The data and the
 * Transmissões / Automações code that reads contact tags are untouched;
 * flip a flag to bring the contact UI back.
 */
export const CONTACT_TAGS_ENABLED = false;
export const CONTACT_CUSTOM_FIELDS_ENABLED = false;
