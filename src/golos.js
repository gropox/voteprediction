var log = require("./logger").getLogger(__filename, 12);
var steem = require("steem");
var global = require("./global");


steem.config.set('websocket',global.settings.golos_websocket);
steem.config.set('address_prefix',"GLS");
steem.config.set('chain_id','782a3039b478c839e4cb0c941ff4eaeb7df40bdd68bd441afd444b9da763de12');

log.debug(steem.config.get('websocket'));

var lastRetrievedProps = 0;

const USERID = global.settings.dobrobot;
const ACTIVE_KEY = global.settings.dobrobotActiveKey;

var props = {};
var lastCommitedBlock = 0;

/** holt properties */
async function retrieveDynGlobProps() {
    props = await steem.api.getDynamicGlobalPropertiesAsync();
}

/** time in milliseconds */
async function getCurrentServerTimeAndBlock() {
    await retrieveDynGlobProps();
    if(props.time) { 
        lastCommitedBlock = props.last_irreversible_block_num;
        log.info("lastCommitedBlock = " + lastCommitedBlock + ", headBlock = " + props.head_block_number);
        return {
            time : Date.parse(props.time), 
            block : props.last_irreversible_block_num 
        };
    }
    throw "Current time could not be retrieved";
}

module.exports.getCurrentServerTimeAndBlock = getCurrentServerTimeAndBlock;
const HIST_BLOCK = 2000;

async function scanUserHistory(userid, scanner) {

        //scan user history backwards, and collect transfers
        let start = -1;
        let count = HIST_BLOCK;
        log.debug("scan history, userid = " + userid);
        while(start == -1 || start > 0) {
            log.debug("\tget history start = "+ start + ", count = " + count);
            let userHistory = await steem.api.getAccountHistoryAsync(userid, start, count);
            if(!(userHistory instanceof Array)) {
                log.error("not an array");
                return;
            }
            
            if(userHistory.length == 0) {
                log.error(userid + " has no history");
                return;
            }
            //log.trace("h = " + JSON.stringify(userHistory));
            let firstReadId = userHistory[0][0];
            log.trace("first id = " + firstReadId);
            let terminate = false;
            for(let h = 0; h < userHistory.length; h++) {
                log.trace("check hist id " + userHistory[h][0] + " / " + userHistory[h][1].op[0]);
                if(userHistory[h][1].block > lastCommitedBlock) {
                    log.trace("last commited block ("+lastCommitedBlock + ") < then tr block (" + userHistory[h][1].block+ ")");
                    continue;
                }
                if(scanner.process(userHistory[h])) {
                    if(!terminate) {
                        terminate = true;
                    }
                }
            }
            log.trace("terminate = " + terminate);
            start = firstReadId-1;
            if(terminate || start <= 0) {
                break;
            }
            count = (start > HIST_BLOCK)?HIST_BLOCK:start;
        }
}

module.exports.checkUser = async function(userid) {
    let users = await steem.api.getAccountsAsync([userid]);
    return (users && users.length > 0);
}


async function scanHistory(scanner) {
    return scanUserHistory(USERID, scanner);
}

module.exports.scanUserHistory = scanUserHistory;
module.exports.scanHistory = scanHistory;


module.exports.transfer = async function(receiver, amount, currency, memo) {
    log.info("transfer " + receiver + ", " + amount + ", [" + memo + "]" );

    if(global.settings.broadcast) {
        log.info("\tbroadcasting transfer");    
        await steem.broadcast.transferAsync(ACTIVE_KEY, USERID, 
            receiver, amount.toFixed(3) + " " + currency, memo);
        
    } else {
        log.info("no broadcasting, dont transfer");
    }
}

module.exports.transferKarma = async function(receiver, amount) {
    log.info("transfer karama " + receiver + ", " + amount );

    if(global.settings.broadcast) {
        log.info("\tbroadcasting transfer karama");    
        await steem.broadcast.transferToVestingAsync(ACTIVE_KEY, USERID, 
            receiver, amount.toFixed(3) + " GOLOS");
        
    } else {
        log.info("no broadcasting, dont transfer karma");
    }
}

module.exports.getExceptionCause = function(e) {
    if(e.cause && e.cause.payload && e.cause.payload.error) {
        let m = e.cause.payload.error.message; 
        if(m) {
            let am = m.split("\n");
            m = am[0];
            for(let i = 1; i < am.length && i < 3; i++) {
                m += ": " + am[i];
            }
            return m;
        }
    }
    return e;
}

async function getGolosPrice() {
    let book = await steem.api.getOrderBookAsync(1);
    log.trace("order book " + JSON.stringify(book));
    if(book.asks.length > 0) {
        return parseFloat(book.asks[0].real_price);
    } else if(book.bids.length > 0) {
        return parseFloat(book.bids[0].real_price);
    }
    return 1;
}

module.exports.getGolosPrice = getGolosPrice;

async function getReputation(userid) {
    let users = await steem.api.getAccountsAsync([userid]);
    
    if(users && users.length > 0) {
        return users[0].reputation;
    }
    return 0;
}

module.exports.getReputation = getReputation;

async function getContent(userid, permlink) {
    log.debug("retrive content for user " + userid + "/" + permlink);
    var content = await steem.api.getContentAsync(userid, permlink);
    if(permlink == content.permlink) {
        return content;
    } 
    return null;
}

module.exports.getContent = getContent;

async function getAccount(userid) {
    log.debug("get acc user " + userid);
    var users = await steem.api.getAccountsAsync([userid]);
    if(users && users.length > 0) {
        return users[0];
    } 
    return null;
}

function convertVerstings(vesting) {
    let SPMV = 1000000.0 * parseFloat(props.total_vesting_fund_steem.split(" ")[0]) / parseFloat(props.total_vesting_shares.split(" ")[0]);
    return SPMV * vesting / 1000000;
}

async function getUserGests(userid) {
    let user = await getAccount(userid);
    let ret = convertVerstings(parseFloat(user.vesting_shares.split(" ")[0]));
    log.debug(userid + " gests " + ret);
    return ret.toFixed(3);
}

module.exports.getUserGests = getUserGests;
