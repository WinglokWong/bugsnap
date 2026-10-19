window.testMessages = [];
window.chrome = { runtime: { onMessage: { addListener: listener => window.collectorListener = listener }, sendMessage: async message => { testMessages.push(message); } } };
