import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory, utils } from "ethers";
import { ethers } from "hardhat";
const { provider } = ethers;
import { toFixedHex } from "../utils/ethers";
import { shouldBehaveLikeProof } from "./proof.behavior";
import fs from "fs";
import path from "path";
import { unstringifyBigInts } from "../utils/ethers";
import { MerkleTree } from "../utils/merkleTree";
import { genProofArgs } from "../utils/crypto";

// import proof.json and public.json
const publicPath = path.join(__dirname, "../build/public.json");
const proofPath = path.join(__dirname, "../build/proof.json");
const pub = unstringifyBigInts(JSON.parse(fs.readFileSync(publicPath, "utf8")));
const proof = unstringifyBigInts(JSON.parse(fs.readFileSync(proofPath, "utf8")));

const HasherPath = "../build/contracts/Hasher.json";
const levels = Number(process.env.MERKLE_TREE_HEIGHT) || 20;
const denomination = process.env.ETH_AMOUNT || "1000000000000000000"; // 1 ether

let Hasher: ContractFactory;
let Verifier: ContractFactory;
let Tornado: ContractFactory;

let hasher: Contract;
let verifier: Contract;
let tornado: Contract;

let signers: SignerWithAddress[];

before(async () => {
  Hasher = await ethers.getContractFactory(require(HasherPath).abi, require(HasherPath).bytecode);
  Verifier = await ethers.getContractFactory("Verifier");
  Tornado = await ethers.getContractFactory("ETHTornado");
  signers = await ethers.getSigners();
});

beforeEach(async function () {
  hasher = await Hasher.deploy();
  verifier = await Verifier.deploy();
  tornado = await Tornado.deploy(verifier.address, denomination, levels, hasher.address);
});

describe("#constructor", () => {
  it("should initialize ", async () => {
    expect(await tornado.denomination()).to.equal(denomination);
  });
});

describe("#deposit", () => {
  it("should emit event", async () => {
    const commitment = toFixedHex(42);
    await expect(await tornado.deposit(commitment, { value: utils.parseEther("1") })).to.emit(tornado, "Deposit");
  });

  it("should revert if there is a such commitment", async () => {
    const commitment = toFixedHex(42);
    await tornado.deposit(commitment, { value: utils.parseEther("1") });
    await expect(tornado.deposit(commitment, { value: utils.parseEther("1") })).to.be.revertedWith(
      "The commitment has been submitted",
    );
  });

  it("should revert if ETH amount not equal to denomination", async () => {
    const commitment = toFixedHex(42);
    await expect(tornado.deposit(commitment, { value: utils.parseEther("2") })).to.be.revertedWith(
      "Please send `mixDenomination` ETH along with transaction",
    );
  });
});

describe("snark proof verification on js side", () => {
  shouldBehaveLikeProof();
});

describe("#withdraw", () => {
  it("should work", async () => {
    const commitment = toFixedHex(42);
    const nullifierHash = toFixedHex(123);
    const tree = new MerkleTree(levels);
    tree.insert(commitment);

    await tornado.deposit(commitment, { value: utils.parseEther("1") });

    const proofArgs = await genProofArgs(proof, pub);
    const args = [toFixedHex(tree.root()), toFixedHex(nullifierHash), signers[1].address, signers[0].address, 0, 0];

    const before = await provider.getBalance(signers[1].address);
    await tornado.withdraw(...proofArgs, ...args);
    const after = await provider.getBalance(signers[1].address);

    expect(after.sub(before)).to.equal(utils.parseEther("1"));
  });
});
