routerAdd("POST", "/api/studio/claim", (e) => {
  const result = require(__hooks + "/lib/studio.js").claim(e.requestInfo().body);
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/studio/reserve", (e) => {
  const result = require(__hooks + "/lib/studio.js").reserve(e.requestInfo().body);
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/studio/complete", (e) => {
  const result = require(__hooks + "/lib/studio.js").complete(e.requestInfo().body);
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/studio/cancel", (e) => {
  return e.json(200, require(__hooks + "/lib/studio.js").cancel(e.requestInfo().body));
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/studio/progress", (e) => {
  return e.json(200, require(__hooks + "/lib/studio.js").progress(e.requestInfo().body));
}, $apis.requireSuperuserAuth());

cronAdd("studio_worker_leases", "* * * * *", () => {
  const lib = require(__hooks + "/lib/studio.js");
  lib.expireLeases();
});
