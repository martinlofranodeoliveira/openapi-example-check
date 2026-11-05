#!/usr/bin/env node
import { checkFiles, CheckError, configurationReport, type Report } from "./index";

export async function runCli(args: readonly string[]): Promise<{ exitCode: number; report: Report }> {
  try {
    if (args.length !== 2 || args.some(arg => arg.length === 0 || arg.startsWith("-"))) {
      throw new CheckError("usage.arguments");
    }
    const report = await checkFiles(args[0]!, args[1]!);
    return { exitCode: report.valid ? 0 : 1, report };
  } catch (error) {
    return { exitCode: 2, report: configurationReport(error) };
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then(({ exitCode, report }) => {
    process.stdout.on("error", () => { process.exitCode = 2; });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = exitCode;
  });
}
