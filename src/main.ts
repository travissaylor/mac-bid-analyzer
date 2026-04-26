#!/usr/bin/env bun
import { dispatch } from "./cli";

if (import.meta.main) {
  const code = await dispatch(Bun.argv.slice(2));
  if (code !== 0) process.exit(code);
}
