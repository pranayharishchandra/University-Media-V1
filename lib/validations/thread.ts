import * as z from "zod";

// export const ThreadValidation = z.object({
//   thread: z.string().nonempty().min(3, { message: "Minimum 3 characters." }),
//   accountId: z.string(),
// });

export const ThreadValidation = z.object({
  thread: z.string().nonempty().min(3, { message: "Minimum 3 characters." }),
  accountId: z.string(),
  image: z
    .instanceof(File)
    .optional()
    .or(z.string().optional()), // <-- this is in case the image is already a URL string
});

export const CommentValidation = z.object({
  thread: z.string().nonempty().min(3, { message: "Minimum 3 characters." }),
  image: z.string().optional(),
});
