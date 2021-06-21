/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const makeSerializable = require("../util/makeSerializable");
const ModuleDependency = require("./ModuleDependency");

// ! EntryPlugin 插件会创建 EntryDependency 对象
class EntryDependency extends ModuleDependency {
	/**
	 * @param {string} request request path for entry
	 */
	constructor(request) {
		super(request);
	}

	get type() {
		return "entry";
	}

	get category() {
		return "esm";
	}
}

makeSerializable(EntryDependency, "webpack/lib/dependencies/EntryDependency");

module.exports = EntryDependency;
