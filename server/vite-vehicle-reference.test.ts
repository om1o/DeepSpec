import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("Vite delegates bounded VIN bodies to the deployed handler and keeps preview offline", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Readable } from "node:stream";
    import configExport from "./vite.config.ts";
    const calls = [];
    const routes = new Map();
    const config = await configExport({command:"serve",mode:"test"});
    const plugin = config.plugins.flat(10).find(entry=>entry?.name==="deep-spec-api");
    plugin.configureServer({
      middlewares:{use:(path,handler)=>routes.set(path,handler)},
      ssrLoadModule:async(path)=>{
        assert.equal(path,"/api/vehicle-reference.ts");
        return {handleVehicleReference:async(req,res,env)=>{
          calls.push({req,marker:env.REFERENCE_PARITY_MARKER});
          res.setHeader("Cache-Control","no-store");res.status(401).json({error:{code:"invalid_session"}});
        }};
      }
    });
    const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}});
    const run=async(method,body)=>{
      const req=Object.assign(Readable.from([body]),{method,headers:{authorization:"Bearer synthetic"}});
      const res=response();await routes.get("/api/vehicle-reference")(req,res);return res;
    };
    const query={vin:"1HGCM82633A000000",modelYear:2003};
    const res=await run("POST",JSON.stringify(query));
    assert.equal(res.statusCode,401);assert.equal(res.body.error.code,"invalid_session");
    assert.equal(res.headers["Cache-Control"],"no-store");
    assert.deepEqual(calls[0].req.body,query);assert.equal(calls[0].req.headers.authorization,"Bearer synthetic");
    assert.equal(calls[0].marker,"present");
    await run("POST","x".repeat(1025));assert.equal(calls[1].req.body,null);
    await run("POST","{broken");assert.equal(calls[2].req.body,null);
    await run("OPTIONS","");assert.equal(calls[3].req.body,undefined);
    const previews=new Map();plugin.configurePreviewServer({middlewares:{use:(path,handler)=>previews.set(path,handler)}});
    const preview=response();previews.get("/api/vehicle-reference")({method:"POST"},preview);
    assert.equal(preview.statusCode,501);assert.equal(preview.body.error.code,"preview_api_unavailable");
    assert.equal(calls.length,4);
    console.log("Vehicle reference Vite parity passed");
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000, env: { ...process.env, REFERENCE_PARITY_MARKER: "present" } });
  expect(output).toContain("Vehicle reference Vite parity passed");
});
