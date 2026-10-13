import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  manifestSchema,
  questionSchema,
  solutionSchema,
} from "../src/models.ts";
mkdirSync("schema", { recursive: true });
for (const [name, schema] of Object.entries({
  manifest: manifestSchema,
  questions: z.array(questionSchema).min(1).max(500),
  solutions: z.array(solutionSchema).min(1).max(500),
})) {
  writeFileSync(
    `schema/${name}.schema.json`,
    JSON.stringify(
      {
        ...z.toJSONSchema(schema),
        $id: `https://spho.local/schema/${name}.schema.json`,
        title: `spho-exam/1.0 ${name}`,
      },
      null,
      2,
    ) + "\n",
  );
}
