exports.addressAndCityToLocation = function (args) {
  return {
    ...args,
    location: args.address + ' ' + args.cityName
  }
}
