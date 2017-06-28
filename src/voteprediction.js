const golos = require("./golos");
const steem = require("steem");
const log = require("./logger").getLogger(__filename);
const global = require("./global");


const MAXAGE = (1000 * 60 * 10) / 3;

function notVoted(content, userid) {
    for(vote of content.active_votes) {
        if(vote.voter == userid) {
            log.info("\t" + userid + " already voted");
            return false;
        }
    }
    return true;
}

async function doVote(vote, userid) {
    if(global.settings.broadcast) {
        await steem.broadcast.voteAsync(global.settings.users[userid], userid, vote.author, vote.permlink, 100 * 100);
    }
    log.info("\t" + userid + " voted (" + global.settings.broadcast + ")");
}

async function followVote(vote) {
    log.info("follow vote " + vote.author + "/" + vote.permlink);
    let content = await steem.api.getContentAsync(vote.author, vote.permlink);
    
    for(let userid of Object.keys(global.settings.users)) {
        if(notVoted(content, userid)) {
            await doVote(vote, userid);
        }
    }
    
}

async function processBlock(bn) {
    
        let transactions = await steem.api.getOpsInBlockAsync(bn, false);
        //log.debug(JSON.stringify(transactions));
        for(let tr of transactions) {
            log.debug("tr " + tr.trx_in_block);
            let op = tr.op[0];
            let opBody = tr.op[1];
            switch(op) {
                case "vote":
                    log.debug("found vote of " + opBody.voter + " for " + opBody.author + "/" + opBody.permlink);
                    if(opBody.voter == global.settings.leader) {
                        await followVote(opBody);
                    }
                    //break;
            }
        }
    
}


/**
 * Для начала мы будет тупо повторять голоса за вожаком. 
 */
module.exports.run = async function() {

    let props = await golos.getCurrentServerTimeAndBlock();
    let block = props.block - 3;
    //DBG block = 7280531 - 1;
    log.info("start looping with block " + block);
    while(true) {
        //log.info("processing block " + block);
        try {
            if(block >= props.block) {
                props = await golos.getCurrentServerTimeAndBlock();
                await sleep(12000);
                continue;
            }
            await processBlock(block++);
        } catch(e) {
            log.error("Error catched in main loop!");
            log.error(golos.getExceptionCause(e));            
            await sleep(3000);
        }
        await sleep(1500);
    }
    process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
