/* eslint-disable no-underscore-dangle */
/* eslint-disable no-await-in-loop */
const {
  parseTransferOperations,
} = require('./tokens');
const { defaultParseEvents } = require('./default');

const { WitnessesContract,
  Contracts
} = require('../history_builder.constants');
const { insertHistoryForAccounts,
  parseEvents
} = require('./util');

async function parsePayloadOperation(collection, sender, action, eventAction, tx, payloadObj) {
  const insertTx = {
    ...tx,
  };

  const accounts = [sender];
  const usedAction = eventAction != null ? eventAction : action;
  switch (usedAction) {
    case WitnessesContract.REGISTER:
      insertTx.ip = payloadObj.IP;
      insertTx.rpcPort = payloadObj.RPCPort;
      insertTx.p2pPort = payloadObj.P2PPort;
      insertTx.signingKey = payloadObj.signingKey;
      insertTx.enabled = payloadObj.enabled;
      break;
    case WitnessesContract.WITNESS_APPROVAL_ADDED:
    case WitnessesContract.WITNESS_APPROVAL_REMOVED:
      insertTx.to = payloadObj.to;
      insertTx.from = sender;
      insertTx.approvalWeight = payloadObj.approvalWeight;
      accounts.push(payloadObj.to);
      break;
    case WitnessesContract.NEW_SCHEDULE:
    case WitnessesContract.CURRENT_WITNESS_CHANGED:
    case WitnessesContract.AWAITING_ROUND_END:
      insertTx.operation += `_${usedAction}`;
      break;
    case WitnessesContract.PROPOSE_ROUND:
      insertTx.round = payloadObj.round;
      insertTx.roundHash = payloadObj.roundHash;
      insertTx.signatures = payloadObj.signatures;
      break;
    default:
      return;
  }

  await insertHistoryForAccounts(collection, insertTx, accounts);
}

async function parseWitnessApprovalsExpired(collection, sender, tx, action, events) {
  const insertTx = {
    ...tx,
  };
  insertTx.operation += `_${action}`;

  const witnesses = [];
  insertTx.from = events[0].data.account;
  insertTx.approvalWeight = events[0].data.approvalWeight;
  for (const expiration of events) {
    const witness = expiration.data.to;
    witnesses.push(witness);
    insertTx.to = witness;
    await insertHistoryForAccounts(collection, insertTx, [witness]);
  }
  insertTx.to = witnesses;

  await insertHistoryForAccounts(collection, insertTx, [sender]);
}

async function parseWitnessEvents(collection, sender, tx, action, events) {
  let lastIdx = 0;
  await parseEvents(events, async (event, idx) => {
    if (event.contract === Contracts.WITNESSES) {
      const insertTx = {
        ...tx,
      };
      if (action === WitnessesContract.SCHEDULE_WITNESSES || action === WitnessesContract.PROPOSE_ROUND) {
        if (event.event === WitnessesContract.WITNESS_APPROVAL_REMOVED) {
          return;
        }
      }
      if (event.event === WitnessesContract.APPROVALS_EXPIRED) {
        await parseWitnessApprovalsExpired(collection, sender, tx, event.event, events.slice(lastIdx, idx).filter((e) => e.event === WitnessesContract.WITNESS_APPROVAL_REMOVED));
        lastIdx = idx;
        return;
      }
      await parsePayloadOperation(collection, sender, action, event.event, insertTx, event.data);
    }
  });
}

async function parseWitnessesContract(accountsHistory, nftHistory, sender, contract, action, tx, events, payloadObj) {
  switch (action) {
    case WitnessesContract.REGISTER:
      await parsePayloadOperation(accountsHistory, sender, action, null, tx, payloadObj);
      break;
    case WitnessesContract.APPROVE:
    case WitnessesContract.DISAPPROVE:
    case WitnessesContract.PROPOSE_ROUND:
    case WitnessesContract.SCHEDULE_WITNESSES:
      await parsePayloadOperation(accountsHistory, sender, action, null, tx, payloadObj);
      await parseWitnessEvents(accountsHistory, sender, tx, action, events);
      await parseTransferOperations(accountsHistory, tx, events, payloadObj);
      break;
    default:
      await defaultParseEvents(accountsHistory, nftHistory, tx, events, payloadObj);
      console.log(`Action ${action} is not implemented for 'witnesses' contract yet.`);
  }
}

module.exports.parseWitnessesContract = parseWitnessesContract;
