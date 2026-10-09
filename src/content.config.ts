// Content collections. Club news lives in content/news/ (format documented in CLAUDE.md).
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const news = defineCollection({
  // File name is the post's address: content/news/2026-10-03-new-website.md -> /news/2026-10-03-new-website/
  loader: glob({ pattern: '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md', base: './content/news' }),
  schema: ({ image }) =>
    z
      .strictObject({
        title: z.string().min(3).max(90),
        date: z.coerce.date(),
        summary: z.string().min(20).max(200),
        image: image().optional(),
        image_alt: z.string().min(5).optional(),
        source: z.url().optional(),
        draft: z.boolean().default(false),
      })
      .refine((p) => !p.image || !!p.image_alt, { message: 'image_alt is required when image is set' }),
});

export const collections = { news };
