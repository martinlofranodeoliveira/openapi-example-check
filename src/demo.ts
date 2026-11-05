import { resolve } from "node:path";
import { checkFiles } from "./index";

async function demo(): Promise<void> {
  const examples = resolve(__dirname, "../../examples");
  const accepted = await checkFiles(resolve(examples, "api.json"), resolve(examples, "valid-cases.json"));
  const rejected = await checkFiles(resolve(examples, "api.json"), resolve(examples, "invalid-cases.json"));
  console.log("Synthetic orders: accepted examples");
  console.log(JSON.stringify(accepted, null, 2));
  console.log("Synthetic orders: deliberately invalid examples");
  console.log(JSON.stringify(rejected, null, 2));
  const expected = [
    ["a-missing", "required", ""],
    ["b-type", "type", "/items/0/quantity"],
    ["c-enum", "enum", "/state"],
    ["d-extra", "additionalProperties", ""],
  ];
  const actual = rejected.errors.map(error => [error.case_id, error.code, error.instance_path]);
  if (!accepted.valid || accepted.cases_checked !== 3 || accepted.errors.length !== 0 ||
      rejected.valid || rejected.cases_checked !== 4 || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("demo.expectation");
  }
  console.log("Expected outcomes confirmed; no network requests were made.");
}

void demo().catch(() => {
  console.error("Demo failed: fixture or configuration did not match the documented expectations.");
  process.exitCode = 2;
});
