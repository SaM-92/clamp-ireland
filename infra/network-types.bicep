@export()
@secure()
@sealed()
type ClientNetwork = {
  @minLength(0)
  @maxLength(16)
  allowedClientIpv4: string[]
}
