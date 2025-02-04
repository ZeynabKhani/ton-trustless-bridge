# ton-trustless-bridge

## What is this repository?
This repository implements a trustless bridge that enables smart contracts on the TON blockchain to verify the existence of transactions from another blockchain without relying on centralized intermediaries. It achieves this by implementing two key smart contracts:
### 1- Lite-Client Smart Contract: 
- This contract maintains a synchronized chain of key blocks from the counterparty blockchain.
- It verifies the validity of new blocks by checking their signatures against the validator set of the last key block.
- It processes two types of messages:
  - new_key_block: Registers and verifies a new key block.
  - check_block: Verifies the validity of an arbitrary block.
    
### 2- Transaction-Checker Smart Contract
- This contract validates Merkle proofs of transactions included in blocks from the counterparty blockchain.
- It processes a check_transaction message containing the transaction data, proof, and transaction block information and interacts with the Lite-Client contract to verify block validity.

**The tests and scripts in this project currently are samples to bridge the masterchains of Ton Fastnet and Ton Testnet.**

## Deployments and Sample Transactions

### Deployed Contracts
- Fastnet
  - Lite-Client Contract: 
  - Transaction-Checker Contract:
 
- Testnet
  - Lite-Client Contract: 
  - Transaction-Checker Contract:
 
### Sample Transactions 
- Fastnet
  - new_key_block:
  - check_transaction (successful):
  - check_transaction (unsuccessful check of block):
  - check_transaction (unsuccessful check of transaction proof):
 
- Testnet
  - new_key_block:
  - check_transaction (successful):
  - check_transaction (unsuccessful check of block):
  - check_transaction (unsuccessful check of transaction proof):

## Project structure

- `contracts` - source code of all the smart contracts of the project and their dependencies.
- `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]serialization primitives and compilation functions.
- `tests` - tests for the contracts.
- `scripts` - scripts used by the project, for deployment, generating data for unit tests, and interacting with contracts.
  
**A complete and fully functional version of the scripts for interacting with the smart contracts, including submitting key blocks, maintaining synchronization between blockchains, and verifying arbitrary transactions, can be found in the [ton-bridge-syncer](https://github.com/TeleportDAO/ton-bridge-syncer)** 

## How to use

### Build

`npx blueprint build` or `yarn blueprint build`

### Test

`npx blueprint test` or `yarn blueprint test`

### Deploy or run another script

`npx blueprint run` or `yarn blueprint run`

