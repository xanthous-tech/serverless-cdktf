import * as fs from "fs"

interface Resource {
        Type: string;
        Properties: Object
}

export function convert(fileName: string) {
    //Readfile.
    const data = fs.readFileSync(fileName)
    const stacks = JSON.parse(data.toString())

    for( const key in stacks.Resources) {
        console.log(`key is ${key}, and value is ${stacks.Resources[key]}`)
        const resource: Resource = stacks.Resources[key]
        mapResource(resource.Type)
    }

}


function mapResource(resourceName: string){
    console.log(`Resource Name is ${resourceName}`)
}

