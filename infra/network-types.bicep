@export()
@secure()
@sealed()
type ClientNetwork = {
  @minLength(1)
  @maxLength(8)
  allowedClientIpv4: string[]
}
