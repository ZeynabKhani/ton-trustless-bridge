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

The implementation details are based on the specifications outlined in the [Ton Trustless Bridge Challenge documentation](https://contest.com/docs/TrustlessBridgeChallenge), ensuring adherence to the required design and security principles.

**The tests and scripts in this project currently are samples to bridge the masterchains of Ton Fastnet and Ton Testnet.**

## Deployments and Sample Transactions

### Deployed Contracts
- Fastnet
  - Lite-Client Contract: Ef-b5QjRXKgR1WeZuEcTuptqgxdOYg7wJsZN9ln9XgkNTJN_
  - Transaction-Checker Contract: Ef-MWu2Iosl1chPf_E7RGVjVNvYGiX7UWgg4rBgxaZbWQhGF
 
- Testnet
  - Lite-Client Contract: kQCPAjpID4kOV-_CuCa929zDjUpRbHdJJtW-KqOG2hwVroTC
  - Transaction-Checker kQC8r7yIql12FCMJRkgMvfJYw3aoFAWwFFBjvk5vB_zg0ja4
 
### Sample Transactions 
- Fastnet
  - new_key_block (successful): 75a76b61799c4ead031222af36254bbe00ed5a3257e7a94d5d818e0c789159c8
  - new_key_block (unsuccessful): 40b934257ca0fab16b42ca724ce0d272154e5b2439d40a22ba31b34788e33dcf
  - check_block (successful): 1eb3d4b1a0520249433bc5c9c62030a1ea1c532209f55f95d573be87afabbf2d
  - check others on the contracts
 
- Testnet
  - new_key_block (successful): [a5fe4bfbe4e2380b5cf0f574f7c5c6af1dbda98d76d1db9b4320ccf900d4ebe4](https://testnet.tonviewer.com/transaction/a5fe4bfbe4e2380b5cf0f574f7c5c6af1dbda98d76d1db9b4320ccf900d4ebe4)
  - new_key_block (unsuccessful): [cfb077fa548aaa638fc356d1b88aa54e8ef62b5f7806903a6cdabb9b768ca92e](https://testnet.tonviewer.com/transaction/cfb077fa548aaa638fc356d1b88aa54e8ef62b5f7806903a6cdabb9b768ca92e)
  - check_transaction (successful): [d505a787b51145e70f78e48b56f16afe40cd47f74130df5a38e672a2fc425c43](https://testnet.tonviewer.com/transaction/d505a787b51145e70f78e48b56f16afe40cd47f74130df5a38e672a2fc425c43)
  - check_transaction (unsuccessful check of block): [f236713805d01109d470e231fae42e566af117271264e9824f1d3ca7563bc4eb](https://testnet.tonviewer.com/transaction/f236713805d01109d470e231fae42e566af117271264e9824f1d3ca7563bc4eb)
  - check_transaction (unsuccessful check of transaction proof): [990322a45b854c137e41e5c6b2df8fab712240b9cb46e81e208ec04979ab1e9b](https://testnet.tonviewer.com/transaction/990322a45b854c137e41e5c6b2df8fab712240b9cb46e81e208ec04979ab1e9b)

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

