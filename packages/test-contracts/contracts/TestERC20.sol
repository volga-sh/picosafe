// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/src/tokens/ERC20.sol";

contract TestERC20 is ERC20 {
    /// @dev Returns the name of the token.
    function name() public view virtual override returns (string memory) {
        return "Test ERC20";
    }

    /// @dev Returns the symbol of the token.
    function symbol() public view virtual override returns (string memory) {
        return "TEST";
    }

    constructor() {
        _mint(msg.sender, 1000000000000000000000000);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

}