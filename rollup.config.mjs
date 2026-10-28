import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default [
  {
    input: "src/plugin.ts",
    output: {
      file: "com.slyon.canyon-wingsuit.sdPlugin/bin/plugin.js",
      format: "esm",
      sourcemap: true
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json"
      }),
      nodeResolve({
        browser: false,
        exportConditions: ["node"],
        preferBuiltins: true
      }),
      commonjs()
    ]
  },
  {
    input: "src/sim-entry.ts",
    output: {
      file: "simulator/sim-bundle.js",
      format: "iife",
      name: "CanyonSim",
      sourcemap: false
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json"
      }),
      nodeResolve({
        browser: true
      }),
      commonjs()
    ]
  }
];
