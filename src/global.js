module.exports.MIN_AMOUNT = 0.001;

module.exports.runtime = {
    dl : 0
}

if(typeof window == "undefined") {

    var fs = require("fs");


    function getConfigDir() {
        if(process.env.CONFIGDIR) {
            return process.env.CONFIGDIR;
        } else {
            return require('os').homedir();
        }
    }

    const CONFIG_DIR = getConfigDir();
    const CONFIG_FILE = CONFIG_DIR + "/voteprediction.js";


    module.exports.settings = {
        golos_host : "https://golos.io",
        golos_websocket : "wss://ws.golos.io",
        broadcast : false,
        minVotePower : 80,
        maxVotePower : 95,
        leaders : {
            "eee" : 80, 
            "ropox" : 20
        },
        users : {
            "ropox" : "5PRIVKEY"
        }
    };


    function init() {
        //Load setting Object
        
        try {
            
            if(fs.existsSync(CONFIG_FILE)) {
                let sets = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
                module.exports.settings = sets;
            } else {
                fs.writeFileSync(CONFIG_FILE, JSON.stringify(module.exports.settings, null, 4), "utf8");
            }                
            
        } catch(e) {
            console.error("unable to read config (" + CONFIG_FILE + ")");
            console.error(e);
        }
    }

    init();
}
