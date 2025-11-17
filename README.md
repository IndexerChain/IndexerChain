# Browser Index Chain

A lightweight blockchain that runs entirely in browsers. All browsers are nodes and miners, and the chain primarily records "index operations" (PUT, APPEND, DELETE) for ordered application logs.

## Architecture

- **core/**: Core types, crypto utilities, and Merkle tree
- **node/**: Node components (storage, state, mempool, miner, network) - *Coming in Phase 2+*
- **ui/**: React UI components

## Development Status

**Phase 4 Complete**: Full browser blockchain with P2P networking!

### Completed Phases

**Phase 1**: Core types, crypto tools, and Merkle tree
- ✅ Type definitions (Operation, Tx, BlockHeader, Block, ChainParams)
- ✅ Crypto utilities using Web Crypto API (sha256, hashBlockHeader)
- ✅ Merkle tree root calculation

**Phase 2**: Chain storage and index state
- ✅ ChainStorage with localStorage persistence
- ✅ IndexState for applying operations
- ✅ Genesis block generation
- ✅ Chain initialization

**Phase 3**: Mining and block production
- ✅ PoW mining in browser
- ✅ Transaction creation and mempool
- ✅ Block building and verification
- ✅ Automatic state updates

**Phase 4**: P2P networking
- ✅ WebSocket signaling server client
- ✅ WebRTC DataChannel peer-to-peer connections
- ✅ Block and transaction broadcasting
- ✅ Chain synchronization
- ✅ Multi-node network support

### Next Steps (Future Phases)
- Difficulty auto-adjustment
- State compression and snapshots
- WebAuthn signature system
- Cross-chain binding
- DAG structure support

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

### 3. Start Signaling Server (for P2P networking)

You need a WebSocket signaling server for P2P connections. A simple example is provided:

```bash
# Install ws (if not already installed)
npm install ws

# Run the example signaling server
node signaling-server-example.js
```

The signaling server will start on `ws://localhost:8080`.

### 4. Connect to Network

1. Open the app in your browser (usually `http://localhost:5173`)
2. Enter the signaling server URL: `ws://localhost:8080`
3. Click "Connect" to join the P2P network
4. Open multiple browser windows to test multi-node networking

### Other Commands

```bash
# Build for production
npm run build

# Type check
npm run type-check
```

## Design Principles

1. **No dependency on other chains** - Completely independent blockchain
2. **Browser as node & miner** - Open webpage = start a light node
3. **Index + ordered log only** - Chain records ordered operation stream
4. **No contracts, no complex VM** - Protocol defines only a few Operation types (PUT, APPEND, DELETE)

## Protocol

### Operation Types
- `PUT`: Write a key-value pair
- `APPEND`: Append a record under a key
- `DELETE`: Delete a key

### PoW Rule
- Hash algorithm: `sha256(JSON.stringify(headerWithoutNonce) + nonce)`
- Difficulty: Hash prefix must have `difficulty` number of hexadecimal zeros
- Example: `difficulty=3` → `000xxxx...`
