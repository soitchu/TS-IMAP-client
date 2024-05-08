const net = require("net");
const opts = {
	host: "localhost",
	port: 143,
	onread: {
		buffer: Buffer.allocUnsafe(4096),
		callback: (size, buf) => {
			console.log(size);
		}
	}
};

net.connect(opts, () => console.log("Connected"));