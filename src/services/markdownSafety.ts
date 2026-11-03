import { defaultSchema } from 'rehype-sanitize';

// Retain the existing prescription details/summary and generated Tailwind classes.
export const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []).filter(tag => !['img', 'picture', 'source'].includes(tag)), 'details', 'summary'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className'],
    details: [...(defaultSchema.attributes?.details || []), 'open'],
  },
};
