sudo su -
apt-get update && apt-get install -y git wget
if [ -d "btcpayserver-docker" ] && [ "$EXISTING_BRANCH" != "master" ] && [ "$EXISTING_REMOTE" != "master" ]; then echo "existing btcpayserver-docker folder found that did not match our specified fork. Moving. (Current branch: $EXISTING_BRANCH, Current remote: $EXISTING_REMOTE)"; mv "btcpayserver-docker" "btcpayserver-docker_$(date +%s)"; fi
if [ -d "btcpayserver-docker" ] && [ "$EXISTING_BRANCH" == "master" ] && [ "$EXISTING_REMOTE" == "master" ]; then echo "existing btcpayserver-docker folder found, pulling instead of cloning."; git pull; fi
if [ ! -d "btcpayserver-docker" ]; then echo "cloning btcpayserver-docker"; git clone -b master https://github.com/btcpayserver/btcpayserver-docker btcpayserver-docker; fi
export BTCPAY_IMAGE=""
export BTCPAY_HOST="${BTCPAY_HOSTNAME}"
export NBITCOIN_NETWORK="mainnet"
export LIGHTNING_ALIAS=""
export BTCPAYGEN_LIGHTNING=""
export BTCPAYGEN_CRYPTO1="btc"
export BTCPAY_ENABLE_SSH=true
export BTCPAYGEN_REVERSEPROXY="none"
export BTCPAY_PROTOCOL="http"
export NOREVERSEPROXY_HTTP_PORT="8888"
export BTCPAYGEN_ADDITIONAL_FRAGMENTS="bitcoin.custom;opt-add-btctransmuter;opt-add-configurator"
export BTCPAYGEN_EXCLUDE_FRAGMENTS="bitcoin"
cd btcpayserver-docker
# add bitcoin.custom.yml to the fragments directory https://docs.btcpayserver.org/FAQ/Deployment/#how-to-deploy-btcpay-server-alongside-existing-bitcoin-node
. ./btcpay-setup.sh -i