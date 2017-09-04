const golos = require("./golos");
const steem = require("steem");
const log = require("./logger").getLogger(__filename);
const global = require("./global");


const MAXAGE =  (1000*60*60*24);
const MINPOWER = 8600;
const MAXPOWER = 10000;
const POWERRANGE = MAXPOWER - MINPOWER;
const RANGE = 0.5;

async function getMinVotePower() {
    let min = MAXPOWER;
    for(let userid of Object.keys(global.settings.users)) {
        let u = await golos.getAccount(userid);
        if(min > u.voting_power) {
            min = u.voting_power;
        }
    }
    log.debug("min voting_power = " + min);
    return min;
}

async function getMaxAge() {
    const minVotingPower = await getMinVotePower();
    const power = minVotingPower - MINPOWER;
    if(power < 0) {
        return MAXAGE;
    }
    const scale = 1 - (power / POWERRANGE / 2);
    return scale * MAXAGE;
}

class Stat {
    constructor(userid, quote) {
        this.userid = userid;
        this.quote = quote;
        this.votes = [];
    }

    cleanupVotes() {
        if(this.votes.length > 0) {
            log.info("oldest vote's age " + ((Date.now() - this.votes[0]) / 1000 / 60 / 60).toFixed(2) + " hours ");
        }
        while(this.votes.length > 0 && this.votes[0] < (Date.now() - getMaxAge())) {
            this.votes.shift();
            log.info("del old vote from " + this.userid + " cnt " + this.votes.length);
        }
    }

    checkVote() {
        this.cleanupVotes();
        return (this.votes.length < this.quote);
    }

    addVote() {
        this.votes.push(Date.now());
        log.info("added vote to " + this.userid + " cnt " + this.votes.length);
    }
}

const STATS = {}
let VOTED = false;

function notVoted(content, userid, vote) {
    for(v of content.active_votes) {
        
        if(v.voter == userid) {
            log.info("found vote of " + userid + " with weight " + v.percent + "(" + vote.weight + ")" );
            if(v.percent == vote.weight) {
                log.info("\t" + userid + " already voted with same weight");
                return false;
            } else {
                break;
            }
        }
    }
    log.info(userid + " not yet voted" );
    return true;    
}

async function doVote(vote, userid) {
    if(global.settings.broadcast) {
        await steem.broadcast.voteAsync(global.settings.users[userid], userid, vote.author, vote.permlink, vote.weight);
    }
    log.info("\t" + userid + " voted (" + global.settings.broadcast + ")");
}

async function followVote(vote) {
    log.info("follow vote " + vote.author + "/" + vote.permlink);
    let content = await steem.api.getContentAsync(vote.author, vote.permlink);
    vote.weight == 10000;
    for(let userid of Object.keys(global.settings.users)) {
        if(notVoted(content, userid, vote)) {
            await doVote(vote, userid);
        }
    }
}

async function processBlock(bn) {
    
        let transactions = await steem.api.getOpsInBlockAsync(bn, false);
        //log.debug(JSON.stringify(transactions));
        for(let tr of transactions) {
            log.trace("tr " + tr.trx_in_block);
            let op = tr.op[0];
            let opBody = tr.op[1];
            switch(op) {
                case "vote":
                    if(global.settings.leaders.includes(opBody.voter)) {
                        log.debug("found vote of " + opBody.voter + " for " + opBody.author + "/" + opBody.permlink);
                        if(opBody.weight > 0 && STATS[opBody.voter].checkVote()) {
                            await followVote(opBody);
                            STATS[opBody.voter].addVote();
                            VOTED = true;
                        }
                    }
                    //break;
            }
        }
    
}


/**
 * Для начала мы будет тупо повторять голоса за вожаком. 
 */
module.exports.run = async function() {

    //FILL Stats
 
    for(let u of global.settings.leaders) {
        STATS[u] = new Stat(u, Math.floor(30 / global.settings.leaders.length));
    }

    let props = await golos.getCurrentServerTimeAndBlock();
    let block = props.block - 3;
    //block = 7780489;
    log.info("start looping with block " + block);
    while(true) {
        //log.info("processing block " + block);
        try {
            if(block >= props.block) {
                props = await golos.getCurrentServerTimeAndBlock();
                await sleep(12000);
                continue;
            }
            VOTED = false;
            await processBlock(block++);
            if(VOTED) {
                log.info("***************************************")
                let leaders = Object.keys(STATS);
                leaders.sort();
                for(let u of leaders) {
                    log.info(u + " votes last 24h : " + STATS[u].votes.length);
                }
            }
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
