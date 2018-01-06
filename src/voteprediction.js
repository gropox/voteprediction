const ga = require("golos-addons");
const golos = ga.golos;
const global = ga.global;

global.initApp("vp");
golos.setWebsocket(global.CONFIG.golos_websocket);

const log = global.getLogger("voteprediction");

const MAXAGE =  (1000*60*60*24);
const MINPOWER = 8600;
const MAXPOWER = 10000;
const POWERRANGE = MAXPOWER - MINPOWER;
const RANGE = 0.5;

async function getMinVotePower() {
    let min = MAXPOWER;
    for(let userid of Object.keys(global.CONFIG.users)) {
        let u = await golos.getAccount(userid);
        if(min > u.voting_power) {
            min = u.voting_power;
        }
    }
    log.info("min voting_power = " + min);
    return min;
}

async function getMaxAge() {
    const minVotingPower = await getMinVotePower();
    const power = minVotingPower - MINPOWER;
    if(power < 0) {
        return MAXAGE;
    }
    const scale = 1 - (power / (POWERRANGE * RANGE));
    log.info("scale = " + scale);
    return scale * MAXAGE;
}

class Stat {
    constructor(userid, quote) {
        this.userid = userid;
        this.quote = quote;
        this.votes = [];
    }

    async cleanupVotes() {
        let maxage = 0;
        if(this.votes.length > 0) {
            maxage = await getMaxAge();
            log.info("max age = " + ((maxage) / 1000 / 60 / 60).toFixed(2) + " hours " )
            log.info("oldest vote's age " + ((Date.now() - this.votes[0]) / 1000 / 60 / 60).toFixed(2) + " hours ");
        }
        while(this.votes.length > 0 && this.votes[0] < (Date.now() - maxage)) {
            this.votes.shift();
            log.info("del old vote from " + this.userid + " cnt " + this.votes.length);
        }
    }

    async checkVote() {
        await this.cleanupVotes();
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
    if(global.CONFIG.broadcast) {
        await golos.golos.broadcast.voteAsync(global.CONFIG.users[userid], userid, vote.author, vote.permlink, vote.weight);
    }
    log.info("\t" + userid + " voted (" + global.CONFIG.broadcast + ")");
}

async function followVote(vote) {
    log.info("follow vote " + vote.author + "/" + vote.permlink);
    let content = await golos.golos.api.getContentAsync(vote.author, vote.permlink);
    //vote.weight == 10000;
    let voted = false;
    for(let userid of Object.keys(global.CONFIG.users)) {
        if(notVoted(content, userid, vote)) {
            await doVote(vote, userid);
            voted = true;
        }
    }
    return voted;
}

async function processBlock(bn) {
    
        let transactions = await golos.golos.api.getOpsInBlockAsync(bn, false);
        //log.debug(JSON.stringify(transactions));
        for(let tr of transactions) {
            log.trace("tr " + tr.trx_in_block);
            let op = tr.op[0];
            let opBody = tr.op[1];
            switch(op) {
                case "vote":
                    if(Object.keys(global.CONFIG.leaders).includes(opBody.voter)) {
                        log.info("found vote of " + opBody.voter + " for " + opBody.author + "/" + opBody.permlink);
                        if(opBody.weight >= 0 && await STATS[opBody.voter].checkVote()) {
                            if(await followVote(opBody)) {
                                STATS[opBody.voter].addVote();
                                VOTED = true;
                            }
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
    const MAX_VOTES = global.CONFIG.shared_votes;
    for(let u of Object.keys(global.CONFIG.leaders)) {
        const votes = Math.floor(MAX_VOTES * global.CONFIG.leaders[u] / 100);
        log.info("add leader " + u + "(votes = " + votes + ")");
        STATS[u] = new Stat(u, votes);
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
