#!/usr/bin/env bun
import { dispatch } from "./cli";

if (import.meta.main) {
  const code = await dispatch(Bun.argv.slice(2));
  process.exit(code);
}
