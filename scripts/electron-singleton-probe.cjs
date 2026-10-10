// Launched by the integration suite with the primary instance's test profile.
const {app}=require('electron');
app.setPath('userData',process.argv[2]);
app.on('browser-window-created',()=>{
  console.error('A secondary FrameLine instance created a window.');
  app.exit(2);
});
require('../src/main.cjs');
setTimeout(()=>{console.error('Secondary instance did not exit.');app.exit(3);},5000).unref();
